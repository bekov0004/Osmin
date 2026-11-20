import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * One Claude Code task run by Osmin in the background: `claude -p` with the stream-json input and output that the
 * Agent SDK uses (checked against Claude Code 2.1):
 *   we send     {"type":"control_request","request_id":…,"request":{"subtype":"initialize"}}
 *               {"type":"user","message":{"role":"user","content":[{"type":"text","text":…}]}}  (any time, also later)
 *   it sends    system/init (session id, model), assistant (text, tool_use), user (tool_result), rate_limit_event (the
 *               plan's 5-hour and weekly use), result (end of a turn: cost, tokens), and, because of
 *               --permission-prompt-tool stdio, control_request can_use_tool before anything that needs permission,
 *               which we answer with control_response (allow, with the input, or deny).
 * The process stays up between turns (stdin open), so the task can be given more to do; a task that ended can be
 * continued with --resume and its session id.
 */

const TRANSCRIPT_MAX = 400;
const TEXT_MAX = 4000;

/** Where the claude command is: the service may not have the user's shell PATH. */
export function findClaude() {
    const fromEnv = GLib.getenv('OSMIN_CLAUDE_BIN');
    if (fromEnv)
        return fromEnv;
    const home = GLib.get_home_dir();
    const candidates = [GLib.find_program_in_path('claude'), `${home}/.npm-global/bin/claude`, `${home}/.local/bin/claude`,
        `${home}/.claude/local/claude`, '/usr/local/bin/claude', '/usr/bin/claude'];
    return candidates.find(path => path && GLib.file_test(path, GLib.FileTest.IS_EXECUTABLE)) ?? null;
}

const VERBS = {
    Bash: 'Running', Read: 'Reading', Write: 'Writing', Edit: 'Editing', MultiEdit: 'Editing', NotebookEdit: 'Editing',
    Grep: 'Searching', Glob: 'Looking for', WebFetch: 'Fetching', WebSearch: 'Searching the web for', Task: 'Delegating',
    Agent: 'Delegating', TodoWrite: 'Planning', LS: 'Listing',
};

/** A tool call in a few words: "Editing src/main.js", "Running npm test". */
export function describeTool(name, input, cwd = '') {
    const relative = path => (cwd && typeof path === 'string' && path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path);
    let detail = '';
    if (input && typeof input === 'object') {
        detail = input.command ?? relative(input.file_path ?? input.notebook_path ?? input.path) ?? input.pattern ?? input.url ??
            input.query ?? input.description ?? '';
        if (!detail && name === 'TodoWrite')
            detail = 'the to-do list';
        if (!detail) {
            const first = Object.values(input).find(v => typeof v === 'string');
            detail = first ?? '';
        }
    }
    detail = String(detail).replace(/\s+/g, ' ').trim();
    if (detail.length > 120)
        detail = `${detail.slice(0, 117)}…`;
    return {verb: VERBS[name] ?? name, detail};
}

const clip = text => {
    text = String(text ?? '');
    return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text;
};

const resultText = content => {
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content))
        return content.map(c => (c.type === 'text' ? c.text : '')).join('\n');
    return '';
};

export class ClaudeTask {
    /**
     * @param {{id: string, cwd: string, prompt: string, model?: string, binary: string, sessionId?: string,
     *   listener: {changed: Function, permission: Function, finished: Function, rateLimit: Function}}} options
     */
    constructor({id, cwd, prompt, model = '', binary, sessionId = '', listener}) {
        this.id = id;
        this.cwd = cwd;
        this.prompt = prompt;
        this.model = model;
        this.binary = binary;
        this.sessionId = sessionId;
        this.listener = listener;
        this.status = 'starting';     // starting | working | waiting (for a permission) | idle (turn done) | done | failed | stopped
        this.current = '';            // what it is doing now, in a few words
        this.startedAt = Date.now();
        this.lastAt = this.startedAt;
        this.costUsd = 0;
        this.tokens = 0;
        this.turns = 0;
        this.error = '';
        this.transcript = [];         // [{kind: user|text|tool|result|error|note, text, tool?, ok?, at}]
        this.pending = [];            // [{requestId, tool, verb, detail, description, input, suggestions}]
        this._process = null;
        this._stdin = null;
        this._stderr = [];
        this._toolEntries = new Map();
        this._requestCounter = 0;
        this._stopping = false;
        this._sessionCost = 0;
    }

    get summary() {
        const last = this.transcript.slice(-1)[0];
        return {
            id: this.id, agent: 'claude', cwd: this.cwd, project: GLib.path_get_basename(this.cwd), prompt: this.prompt.slice(0, 200),
            status: this.status, current: this.current, startedAt: this.startedAt, lastAt: this.lastAt, costUsd: this.costUsd,
            tokens: this.tokens, turns: this.turns, error: this.error, sessionId: this.sessionId, model: this.model,
            pending: this.pending.map(p => ({requestId: p.requestId, tool: p.tool, verb: p.verb, detail: p.detail, description: p.description})),
            last: last ? {kind: last.kind, text: (last.text ?? '').slice(0, 160), tool: last.tool ?? ''} : null,
            running: !!this._process,
        };
    }

    get running() {
        return !!this._process;
    }

    start(message = this.prompt) {
        const argv = [this.binary, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
            '--permission-prompt-tool', 'stdio'];
        if (this.model)
            argv.push('--model', this.model);
        if (this.sessionId)
            argv.push('--resume', this.sessionId);
        const launcher = new Gio.SubprocessLauncher({
            flags: Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        launcher.set_cwd(this.cwd);
        launcher.setenv('CLAUDE_CODE_ENTRYPOINT', 'osmin', true);
        try {
            this._process = launcher.spawnv(argv);
        } catch (e) {
            this._fail(`Claude Code could not start: ${e.message}`);
            return;
        }
        this._stopping = false;
        this._sessionCost = 0;         // a new process counts the session's cost from zero
        this.status = 'working';
        this.current = 'Starting';
        this._stdin = this._process.get_stdin_pipe();
        this._readLines(this._process.get_stdout_pipe(), line => this._onLine(line));
        this._readLines(this._process.get_stderr_pipe(), line => {
            this._stderr.push(line);
            if (this._stderr.length > 20)
                this._stderr.shift();
        });
        const process = this._process;
        process.wait_async(null, () => this._onExit(process));
        this._write({type: 'control_request', request_id: this._nextRequest(), request: {subtype: 'initialize'}});
        this._message(message);
        this._changed();
    }

    _message(text) {
        this._add({kind: 'user', text: clip(text)});
        this._write({type: 'user', message: {role: 'user', content: [{type: 'text', text}]}});
        this.status = 'working';
        this.current = 'Thinking';
    }

    /** More to do: in the running process, or (the process ended) continuing the session. */
    send(text) {
        text = String(text ?? '').trim();
        if (!text)
            return;
        if (!this._process) {
            // the process ended: start again, continuing the session (--resume) when there is one
            this.error = '';
            this.start(text);
            return;
        }
        this._message(text);
        this._changed();
    }

    /** @param {'allow'|'always'|'deny'} decision */
    answer(requestId, decision) {
        const index = this.pending.findIndex(p => p.requestId === requestId);
        if (index < 0)
            return false;
        const [request] = this.pending.splice(index, 1);
        const response = decision === 'deny'
            ? {behavior: 'deny', message: 'The user denied this in Osmin.'}
            : {behavior: 'allow', updatedInput: request.input, ...(decision === 'always' && request.suggestions?.length ? {updatedPermissions: request.suggestions} : {})};
        this._write({type: 'control_response', response: {subtype: 'success', request_id: requestId, response}});
        this._add({kind: 'note', text: `${decision === 'deny' ? 'Denied' : decision === 'always' ? 'Allowed for this session' : 'Allowed'}: ${request.verb} ${request.detail}`.trim()});
        if (!this.pending.length && this.status === 'waiting')
            this.status = 'working';
        this._changed();
        return true;
    }

    /** Stops what it is doing now (the session stays, more can be asked). */
    interrupt() {
        if (!this._process)
            return;
        this._write({type: 'control_request', request_id: this._nextRequest(), request: {subtype: 'interrupt'}});
        // permissions still asked are moot now
        for (const request of this.pending.splice(0))
            this._write({type: 'control_response', response: {subtype: 'success', request_id: request.requestId, response: {behavior: 'deny', message: 'Interrupted.'}}});
        this.current = 'Stopping';
        this._changed();
    }

    /** Ends the process (the session can still be continued). */
    stop() {
        if (!this._process)
            return;
        this._stopping = true;
        this.interrupt();
        try {
            this._stdin?.close(null);
        } catch (e) {
            // already closed
        }
        const process = this._process;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2500, () => {
            if (this._process === process)
                process.force_exit();
            return GLib.SOURCE_REMOVE;
        });
    }

    // --- the stream ---------------------------------------------------------------------------------------------

    _nextRequest() {
        return `osmin-${this.id}-${++this._requestCounter}`;
    }

    _write(object) {
        if (!this._stdin)
            return;
        try {
            const bytes = new TextEncoder().encode(`${JSON.stringify(object)}\n`);
            this._stdin.write_all(bytes, null);
            this._stdin.flush(null);
        } catch (e) {
            // the process is gone; its exit is handled there
        }
    }

    _readLines(stream, onLine) {
        const input = new Gio.DataInputStream({base_stream: stream});
        const next = () => input.read_line_async(GLib.PRIORITY_DEFAULT, null, (_s, result) => {
            let line;
            try {
                [line] = input.read_line_finish_utf8(result);
            } catch (e) {
                return;
            }
            if (line === null)
                return;
            onLine(line);
            next();
        });
        next();
    }

    _onLine(line) {
        let message;
        try {
            message = JSON.parse(line);
        } catch (e) {
            return;
        }
        this.lastAt = Date.now();
        switch (message.type) {
        case 'system':
            if (message.subtype === 'init') {
                this.sessionId = message.session_id ?? this.sessionId;
                this.model = message.model ?? this.model;
                this.current = 'Thinking';
            } else if (message.subtype === 'thinking_tokens') {
                this.current = 'Thinking';
            }
            break;
        case 'assistant':
            for (const block of message.message?.content ?? []) {
                if (block.type === 'text' && block.text?.trim()) {
                    this._add({kind: 'text', text: clip(block.text)});
                    this.current = 'Writing';
                } else if (block.type === 'tool_use') {
                    const {verb, detail} = describeTool(block.name, block.input, this.cwd);
                    const entry = this._add({kind: 'tool', tool: block.name, text: `${verb} ${detail}`.trim()});
                    this._toolEntries.set(block.id, entry);
                    this.current = `${verb} ${detail}`.trim();
                } else if (block.type === 'thinking') {
                    this.current = 'Thinking';
                }
            }
            break;
        case 'user':
            for (const block of message.message?.content ?? []) {
                if (block.type !== 'tool_result')
                    continue;
                const entry = this._toolEntries.get(block.tool_use_id);
                if (entry) {
                    entry.ok = !block.is_error;
                    entry.output = clip(resultText(block.content)).slice(0, 600);
                    this._toolEntries.delete(block.tool_use_id);
                }
                this.current = 'Thinking';
            }
            break;
        case 'rate_limit_event':
            this.listener.rateLimit?.(message.rate_limit_info ?? {});
            break;
        case 'control_request':
            this._onControlRequest(message);
            break;
        case 'result': {
            this.turns += message.num_turns ?? 0;
            // total_cost_usd is the cost of the session so far
            if (typeof message.total_cost_usd === 'number') {
                this.costUsd += Math.max(0, message.total_cost_usd - this._sessionCost);
                this._sessionCost = message.total_cost_usd;
            }
            const usage = message.usage ?? {};
            this.tokens += (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) +
                (usage.cache_read_input_tokens ?? 0);
            const ok = !message.is_error && message.subtype === 'success';
            this._add({kind: 'result', ok, text: clip(message.result ?? (ok ? 'Done' : message.subtype ?? 'Error'))});
            this.status = ok ? 'idle' : 'failed';
            if (!ok)
                this.error = String(message.result ?? message.subtype ?? 'error').slice(0, 300);
            this.current = ok ? 'Done' : 'Stopped with an error';
            this.listener.finished?.(this, ok);
            break;
        }
        default:
            break;
        }
        this._changed();
    }

    _onControlRequest(message) {
        const request = message.request ?? {};
        if (request.subtype === 'can_use_tool') {
            const {verb, detail} = describeTool(request.tool_name, request.input, this.cwd);
            const entry = {
                requestId: message.request_id, tool: request.display_name ?? request.tool_name, verb, detail,
                description: request.description ?? '', input: request.input ?? {}, suggestions: request.permission_suggestions ?? [],
            };
            this.pending.push(entry);
            this.status = 'waiting';
            this.current = `Waiting for you: ${verb} ${detail}`.trim();
            this.listener.permission?.(this, entry);
            return;
        }
        // nothing else is offered by Osmin: say so, so that Claude Code does not wait
        this._write({type: 'control_response', response: {subtype: 'error', request_id: message.request_id, error: `Osmin does not handle ${request.subtype}`}});
    }

    _onExit(process) {
        if (this._process !== process)
            return;
        this._process = null;
        this._stdin = null;
        this.pending = [];
        let code = -1;
        try {
            code = process.get_if_exited() ? process.get_exit_status() : -1;
        } catch (e) {
            code = -1;
        }
        if (this._stopping) {
            this.status = 'stopped';
            this.current = 'Stopped';
            this._add({kind: 'note', text: 'Stopped'});
        } else if (this.status === 'idle' || this.status === 'done') {
            this.status = 'done';
            this.current = 'Done';
        } else if (code === 0) {
            this.status = 'done';
            this.current = 'Done';
        } else {
            this._fail(this._stderr.slice(-3).join(' ').trim() || `Claude Code ended (${code})`);
            return;
        }
        this._changed();
    }

    _fail(text) {
        this.status = 'failed';
        this.error = text.slice(0, 300);
        this.current = 'Failed';
        this._add({kind: 'error', text: this.error});
        this.listener.finished?.(this, false);
        this._changed();
    }

    _add(entry) {
        entry.at = Date.now();
        this.transcript.push(entry);
        if (this.transcript.length > TRANSCRIPT_MAX)
            this.transcript.splice(0, this.transcript.length - TRANSCRIPT_MAX);
        return entry;
    }

    _changed() {
        this.listener.changed?.(this);
    }
}
