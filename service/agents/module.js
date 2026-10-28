import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Module} from '../module.js';

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
 * state: {agents: [{id, name, installed, working: [{project, since}], tokens5h, tokens7d, messages5h, last}]}
 * events: finished {agent, name, project, seconds}
 */
export class AgentsModule extends Module {
    constructor() {
        super('Agents');
        this._files = new Map();   // path -> {agent, offset, entries: [[ts, tokens]], project, modified, activeSince}
        this._timer = 0;
        this._summary = AGENTS.map(a => ({id: a.id, name: a.name, installed: false, working: [], tokens5h: 0, tokens7d: 0, messages5h: 0, last: 0}));
    }

    get state() {
        return {agents: this._summary};
    }

    start() {
        this._poll();
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
            this._poll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (this._timer)
            GLib.source_remove(this._timer);
        this._timer = 0;
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
        for (const [path, file] of this._files) {
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
            const working = now - file.modified <= ACTIVE_MS;
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
        this.emitState();
    }
}
