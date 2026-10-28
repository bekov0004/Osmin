import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {EventType, Priority} from '../../utils/events.js';
import {OsminWidget} from '../widget.js';

const compact = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));

/**
 * AI agents: whether Claude Code and Codex are working right now (and in which project), the
 * tokens of the last five hours and the last week, and a card when a long task finishes. It reads
 * only the token counts and times of the agents' own session logs on this computer.
 */
export class AgentsWidget extends OsminWidget {
    static id = 'agents';
    static title = 'AI Agents';
    static iconName = 'system-run-symbolic';

    constructor(context) {
        super(context);
        this._agents = context.services.agents;
        this._events = context.events;
        this._settings = context.settings;
    }

    start() {
        this._agents.connectObject('finished', (_a, info) => this._onFinished(info), this);
    }

    _onFinished(info) {
        if (!this._settings.get('agents-alerts'))
            return;
        const minutes = Math.max(1, Math.round(info.seconds / 60));
        this._events.emit({
            type: EventType.CUSTOM,
            icon: 'emblem-ok-symbolic',
            title: `${info.name} finished`,
            description: `${info.project} · ${minutes} min`,
            priority: Priority.HIGH,
            duration: 6000,
        });
    }

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-agents',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        root.add_child(new St.Label({text: 'AI AGENTS', style_class: 'osmin-todo-caption'}));
        this._list = new St.BoxLayout({vertical: true, x_expand: true});
        root.add_child(this._list);
        this._agents.connectObject('changed', () => this._rebuild(), this);
        return root;
    }

    onViewCreated() {
        this._rebuild();
    }

    _rebuild() {
        if (!this._view)
            return;
        this._list.destroy_all_children();
        const agents = this._agents.agents.filter(a => a.installed);
        if (agents.length === 0) {
            this._list.add_child(new St.Label({text: 'No agents found (Claude Code, Codex)', style_class: 'osmin-todo-empty'}));
            return;
        }
        for (const agent of agents) {
            const row = new St.BoxLayout({style_class: 'osmin-agent', x_expand: true});
            const dot = new St.Widget({style_class: `osmin-agent-dot${agent.working.length > 0 ? ' working' : ''}`, y_align: Clutter.ActorAlign.CENTER});
            row.add_child(dot);
            const texts = new St.BoxLayout({vertical: true, x_expand: true});
            texts.add_child(new St.Label({text: agent.name, style_class: 'osmin-agent-name'}));
            const status = agent.working.length > 0
                ? `Working · ${agent.working.map(w => w.project).join(', ')}`
                : agent.last ? `Idle · ${Math.round((Date.now() - agent.last) / 60000)} min ago` : 'No sessions yet';
            texts.add_child(new St.Label({text: status, style_class: 'osmin-agent-status'}));
            row.add_child(texts);
            const usage = new St.BoxLayout({vertical: true, x_align: Clutter.ActorAlign.END});
            usage.add_child(new St.Label({text: `5 h  ${compact(agent.tokens5h)}`, style_class: 'osmin-agent-usage'}));
            usage.add_child(new St.Label({text: `7 d  ${compact(agent.tokens7d)}`, style_class: 'osmin-agent-usage'}));
            row.add_child(usage);
            this._list.add_child(row);
        }
    }

    destroy() {
        this._agents.disconnectObject(this);
        super.destroy();
    }
}
