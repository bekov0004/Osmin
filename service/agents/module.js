import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Module} from '../module.js';
import {ClaudeTask, findClaude} from './claudeTask.js';
import {openInTerminal} from './terminal.js';
import {ClaudeUsage} from './usage.js';

const POLL_MS = 8000;
const ACTIVE_MS = 20000;        // a session written to within this long is working
const LONG_TASK_MS = 60000;     // a task that ran this long is worth a "finished" card
const FIVE_HOURS = 5 * 3600 * 1000;
const WEEK = 7 * 24 * 3600 * 1000;

const home = GLib.get_home_dir();
const AGENTS = [
    {id: 'claude', name: 'Claude Code', root: GLib.getenv('OSMIN_CLAUDE_DIR') || `${home}/.claude/projects`, depth: 2},
    {id: 'codex', name: 'Codex', root: GLib.getenv('OSMIN_CODEX_DIR') || `${home}/.codex/sessions`, depth: 4},
];

const listFiles = (dir, depth) => {
    const result = [];
    try {
        const enumerator = Gio.File.new_for_path(dir).enumerate_children('standard::name,standard::type,time::modified', Gio.FileQueryInfoFlags.NONE, null);
        for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
            const path = `${dir}/${info.get_name()}`;
            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                if (depth > 0)
                    result.push(...listFiles(path, depth - 1));
            } else if (info.get_name().endsWith('.jsonl')) {
                result.push({path, modified: info.get_attribute_uint64('time::modified') * 1000});
            }
        }
    } catch (e) {
        // the agent is not installed
    }
    return result;
};

/**
 * AI coding agents at a glance, from their own local session logs (Claude Code in ~/.claude/projects,
 * Codex in ~/.codex/sessions): which sessions are working right now, how many tokens the last five
 * hours and the last week used, and a note when a long task is done. The logs are only read;
 * nothing is sent anywhere and the prompts are not looked at (only the token counts and times).
 *
 * It also runs tasks: Claude Code in the background (claudeTask.js: what it does, live; more to ask; its questions
 * about permissions, answered from Osmin) or an agent in a terminal; and it knows the plan's limits (usage.js) and
 * the projects the agents worked in lately.
 *
 * state: {agents: [{id, name, installed, working: [{project, since}], tokens5h, tokens7d, messages5h, last}],
 *         tasks: [task summaries, newest first], usage, projects: [{path, name, last}], claude: bool, codex: bool}
 * events: finished {agent, name, project, seconds}                  a session seen in the logs went quiet
 *         permission {id, project, requestId, tool, verb, detail}   a background task asks
 *         task-finished {id, project, ok, text, costUsd}             a background task's turn ended
 */
export class AgentsModule extends Module {
    /** @param {Gio.Application} app opens the agents window */
    constructor(app = null) {
        super('Agents');
        this._app = app;
        this._files = new Map();   // path -> {agent, offset, entries: [[ts, tokens]], project, modified, activeSince, cwd}
        this._timer = 0;
        this._usageTimer = 0;
        this._summary = AGENTS.map(a => ({id: a.id, name: a.name, installed: false, working: [], tokens5h: 0, tokens7d: 0, messages5h: 0, last: 0}));
        this._tasks = new Map();   // id -> ClaudeTask
        this._listeners = new Set();
        this._emitPending = 0;
        this._projects = [];
        this._usage = new ClaudeUsage(() => this._changed());
    }

    get state() {
        return {
            agents: this._summary,
            tasks: [...this._tasks.values()].map(t => t.summary).sort((a, b) => b.startedAt - a.startedAt),
            usage: this._usage.state,
            projects: this._projects,
            claude: !!findClaude(),
            codex: !!GLib.find_program_in_path('codex'),
        };
    }

    get busy() {
        return [...this._tasks.values()].some(t => t.running);
    }

    task(id) {
        return this._tasks.get(id) ?? null;
    }

    /** The agents window follows the tasks: @returns {() => void} to stop. */
    addListener(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    }

    /** Something changed: the window at once, the shell a moment later (once for many lines). */
    _changed() {
        for (const callback of this._listeners) {
            try {
                callback();
            } catch (e) {
                console.warn(`[osmin-service] agents window: ${e.message}`);
            }
        }
        if (this._emitPending)
            return;
        this._emitPending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            this._emitPending = 0;
            this.emitState();
            return GLib.SOURCE_REMOVE;
        });
    }

    start() {
        this._poll();
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            this._poll();
            return GLib.SOURCE_CONTINUE;
        });
        this._usage.refresh({force: true}).catch(() => {});
        this._usageTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => {
            this._usage.refresh().catch(() => {});
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._timer)
            GLib.source_remove(this._timer);
        if (this._usageTimer)
            GLib.source_remove(this._usageTimer);
        if (this._emitPending)
            GLib.source_remove(this._emitPending);
        this._timer = this._usageTimer = this._emitPending = 0;
        for (const task of this._tasks.values())
            task.stop();
    }

    // --- tasks -------------------------------------------------------------------------------------------------

    /**
     * @param {{cwd: string, prompt: string, where?: 'background'|'terminal', model?: string, agent?: 'claude'|'codex'}} args
     * @returns {{id?: string, terminal?: string}}
     */
    async rpc_startTask({cwd, prompt = '', where = 'background', model = '', agent = 'claude'}) {
        cwd = String(cwd ?? '').replace(/^~(?=\/|$)/, GLib.get_home_dir());
        if (!cwd || !GLib.file_test(cwd, GLib.FileTest.IS_DIR))
            throw new Error(`No such folder: ${cwd}`);
        prompt = String(prompt ?? '').trim();
        if (agent === 'codex') {
            const codex = GLib.find_program_in_path('codex');
            if (!codex)
                throw new Error('Codex is not installed');
            return {terminal: openInTerminal(codex, cwd, prompt ? [prompt] : [])};
        }
        const binary = findClaude();
        if (!binary)
            throw new Error('Claude Code is not installed (the claude command was not found)');
        if (where === 'terminal')
            return {terminal: openInTerminal(binary, cwd, [...(model ? ['--model', model] : []), ...(prompt ? [prompt] : [])])};
        if (!prompt)
            throw new Error('What should it do?');
        const id = GLib.uuid_string_random().slice(0, 8);
        const task = new ClaudeTask({
            id, cwd, prompt, model, binary,
            listener: {
                changed: () => this._changed(),
                rateLimit: info => this._usage.update(info),
                permission: (t, request) => this.emitEvent('permission', {
                    id: t.id, project: t.summary.project, requestId: request.requestId, tool: request.tool, verb: request.verb,
                    detail: request.detail, description: request.description,
                }),
                finished: (t, ok) => {
                    const last = [...t.transcript].reverse().find(e => e.kind === 'result' || e.kind === 'error');
                    const text = last?.answer ?? last?.text ?? '';
                    this.emitEvent('task-finished', {id: t.id, project: t.summary.project, ok, text: text.slice(0, 200), costUsd: t.costUsd});
                },
            },
        });
        this._tasks.set(id, task);
        this._trim();
        task.start();
        this._changed();
        return {id};
    }

    _need(id) {
        const task = this._tasks.get(id);
        if (!task)
            throw new Error('No such task');
        return task;
    }

    async rpc_send({id, text}) {
        this._need(id).send(text);
        return {};
    }

    async rpc_answer({id, requestId, decision}) {
        return {answered: this._need(id).answer(requestId, decision)};
    }

    async rpc_interrupt({id}) {
        this._need(id).interrupt();
        return {};
    }

    async rpc_stop({id}) {
        this._need(id).stop();
        return {};
    }

    async rpc_remove({id}) {
        const task = this._tasks.get(id);
        task?.stop();
        this._tasks.delete(id);
        this._changed();
        return {};
    }

    async rpc_transcript({id}) {
        return {transcript: this._need(id).transcript};
    }

    async rpc_refreshUsage() {
        await this._usage.refresh({force: true});
        return {usage: this._usage.state};
    }

    async rpc_openWindow({id = '', newTask = false} = {}) {
        this._app?.openAgents?.({id, newTask});
        return {};
    }

    /** Keeps the 20 newest tasks (the running ones always). */
    _trim() {
        const finished = [...this._tasks.values()].filter(t => !t.running).sort((a, b) => b.startedAt - a.startedAt);
        for (const task of finished.slice(20))
            this._tasks.delete(task.id);
    }

    _poll() {
        const now = Date.now();
        for (const agent of AGENTS) {
            for (const {path, modified} of listFiles(agent.root, agent.depth)) {
                if (now - modified > WEEK)
                    continue;
                let file = this._files.get(path);
                if (!file) {
                    const parts = path.slice(agent.root.length + 1).split('/');
                    file = {agent: agent.id, offset: 0, entries: [], project: agent.id === 'claude' ? this._projectName(parts[0]) : 'session', modified: 0, activeSince: 0};
                    this._files.set(path, file);
                }
                if (modified !== file.modified) {
                    this._read(path, file);
                    file.modified = modified;
                }
            }
        }
        this._summarise(now);
    }

    /** "-home-me-Projects-My-Osmin" -> "Osmin" */
    _projectName(folder) {
        const parts = folder.split('-').filter(Boolean);
        return parts[parts.length - 1] ?? folder;
    }

    /** Reads what was appended since the last time: the times and token counts of the messages. */
    _read(path, file) {
        try {
            const stream = Gio.File.new_for_path(path).read(null);
            const size = Gio.File.new_for_path(path).query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
            if (size < file.offset) {
                file.offset = 0;
                file.entries = [];
            }
            stream.skip(file.offset, null);
            const bytes = stream.read_bytes(Math.min(size - file.offset, 8 * 1024 * 1024), null);
            stream.close(null);
            const text = new TextDecoder().decode(bytes.toArray());
            const lastNewline = text.lastIndexOf('\n');
            const complete = lastNewline >= 0 ? text.slice(0, lastNewline) : '';
            file.offset += new TextEncoder().encode(complete).length + (lastNewline >= 0 ? 1 : 0);
            for (const line of complete.split('\n')) {
                if (!line)
                    continue;
                let entry;
                try {
                    entry = JSON.parse(line);
                } catch (e) {
                    continue;
                }
                if (typeof entry?.cwd === 'string' && entry.cwd)
                    file.cwd = entry.cwd;
                if (typeof entry?.sessionId === 'string')
                    file.sessionId = entry.sessionId;
                const usage = entry?.message?.usage ?? entry?.payload?.info?.last_token_usage ?? null;
                const at = Date.parse(entry?.timestamp ?? '');
                if (!usage || !Number.isFinite(at))
                    continue;
                const tokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) +
                    (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
                file.entries.push([at, tokens]);
            }
        } catch (e) {
            // the file went away or is half written: next time
        }
    }

    _summarise(now) {
        const summary = AGENTS.map(a => ({id: a.id, name: a.name, installed: false, working: [], tokens5h: 0, tokens7d: 0, messages5h: 0, last: 0}));
        // the sessions of Osmin's own background tasks are shown as tasks, not again as "working"
        const ours = new Set([...this._tasks.values()].map(t => t.sessionId).filter(Boolean));
        const projects = new Map();
        for (const [path, file] of this._files) {
            if (file.cwd && (!projects.has(file.cwd) || projects.get(file.cwd) < file.modified))
                projects.set(file.cwd, file.modified);
            const entry = summary.find(s => s.id === file.agent);
            entry.installed = true;
            file.entries = file.entries.filter(e => now - e[0] <= WEEK);
            for (const [at, tokens] of file.entries) {
                entry.tokens7d += tokens;
                if (now - at <= FIVE_HOURS) {
                    entry.tokens5h += tokens;
                    entry.messages5h++;
                }
                entry.last = Math.max(entry.last, at);
            }
            const working = now - file.modified <= ACTIVE_MS && !ours.has(GLib.path_get_basename(path).replace(/\.jsonl$/, ''));
            if (working) {
                if (!file.activeSince)
                    file.activeSince = file.modified;
                entry.working.push({project: file.project, since: file.activeSince});
            } else if (file.activeSince) {
                // It stopped: a long task is worth telling about.
                const seconds = Math.round((file.modified - file.activeSince) / 1000);
                file.activeSince = 0;
                if (seconds * 1000 >= LONG_TASK_MS)
                    this.emitEvent('finished', {agent: file.agent, name: entry.name, project: file.project, seconds});
            }
            if (!GLib.file_test(path, GLib.FileTest.EXISTS))
                this._files.delete(path);
        }
        for (const a of AGENTS) {
            const entry = summary.find(s => s.id === a.id);
            entry.installed = entry.installed || GLib.file_test(a.root, GLib.FileTest.IS_DIR);
        }
        this._summary = summary;
        this._projects = [...projects.entries()]
            .filter(([path]) => GLib.file_test(path, GLib.FileTest.IS_DIR))
            .sort((a, b) => b[1] - a[1]).slice(0, 12)
            .map(([path, last]) => ({path, name: GLib.path_get_basename(path), last}));
        this.emitState();
    }
}
