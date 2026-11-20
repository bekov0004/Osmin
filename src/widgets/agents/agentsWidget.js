import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {EventType, Priority} from '../../utils/events.js';
import {menuCard, menuChip, menuDivider, menuHeader, pillButton, setChecked, usageBar} from '../../ui/menuKit.js';
import {OsminWidget} from '../widget.js';

const compact = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
const money = usd => (usd >= 0.01 ? `$${usd.toFixed(2)}` : usd > 0 ? '<$0.01' : '');

const until = ms => {
    const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
    if (m < 60)
        return `${m} min`;
    if (m < 48 * 60)
        return `${Math.floor(m / 60)} h ${m % 60} min`;
    return `${Math.floor(m / 1440)} d`;
};

const ago = ms => {
    const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
};

const STATUS_TEXT = {
    starting: 'Starting', working: 'Working', waiting: 'Needs you', idle: 'Done', done: 'Done', failed: 'Failed', stopped: 'Stopped',
};

/**
 * AI agents: the Claude plan's limits (5 hours, week), a new task (a recent project, what to do, in the background or
 * in a terminal), the background tasks with what each is doing right now, their questions (Allow / Deny) and buttons
 * to open, stop or remove them, and the agents working elsewhere (a terminal) seen in their logs. The full view of a
 * task is the agents window of the Osmin app.
 */
export class AgentsWidget extends OsminWidget {
    static id = 'agents';
    static title = 'AI Agents';
    static iconName = 'system-run-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._agents = context.services.agents;
        this._events = context.events;
        this._settings = context.settings;
        this._project = '';
        this._where = 'background';
        this._error = '';
    }

    start() {
        this._agents.connectObject(
            'finished', (_a, info) => this._onFinished(info),
            'task-finished', (_a, info) => this._onTaskFinished(info),
            this);
    }

    _onFinished(info) {
        if (!this._settings.get('agents-alerts'))
            return;
        const minutes = Math.max(1, Math.round(info.seconds / 60));
        this._events.emit({
            type: EventType.CUSTOM, icon: 'emblem-ok-symbolic', title: `${info.name} finished`,
            description: `${info.project} · ${minutes} min`, priority: Priority.HIGH, duration: 6000,
        });
    }

    _onTaskFinished(info) {
        if (!this._settings.get('agents-alerts'))
            return;
        this._events.emit({
            type: EventType.CUSTOM, icon: info.ok ? 'emblem-ok-symbolic' : 'dialog-warning-symbolic',
            title: info.ok ? `Claude finished · ${info.project}` : `Claude stopped · ${info.project}`,
            description: info.text || money(info.costUsd), priority: Priority.HIGH, duration: 6000,
        });
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-agents osmin-menu-page', x_expand: true});

        // the plan's limits
        this._usageCard = menuCard();
        root.add_child(this._usageCard);

        // a new task
        root.add_child(menuHeader('New task'));
        const newCard = menuCard();
        this._projects = new St.BoxLayout({style_class: 'osmin-chips-row osmin-card-pad osmin-agent-projects', x_expand: true});
        newCard.add_child(this._projects);
        this._entry = new St.Entry({style_class: 'osmin-entry osmin-agent-entry', hint_text: 'What should Claude do?', can_focus: true, x_expand: true});
        this._entry.clutter_text.connect('activate', () => this._start(this._where));
        const entryRow = new St.BoxLayout({style_class: 'osmin-card-pad', x_expand: true});
        entryRow.add_child(this._entry);
        newCard.add_child(entryRow);
        const actions = new St.BoxLayout({style_class: 'osmin-chips-row osmin-card-pad', x_expand: true});
        actions.add_child(menuChip({label: 'Start', icon: 'media-playback-start-symbolic', primary: true, onClick: () => this._start('background')}));
        actions.add_child(menuChip({label: 'In a terminal', icon: 'utilities-terminal-symbolic', onClick: () => this._start('terminal')}));
        actions.add_child(menuChip({label: 'More…', icon: 'view-more-symbolic', onClick: () => this._open({newTask: true})}));
        newCard.add_child(actions);
        this._note = new St.Label({style_class: 'osmin-hint', visible: false});
        this._note.clutter_text.line_wrap = true;
        newCard.add_child(this._note);
        root.add_child(newCard);

        // the tasks
        this._tasksHeader = menuHeader('Tasks');
        root.add_child(this._tasksHeader);
        this._tasks = new St.BoxLayout({vertical: true, x_expand: true});
        root.add_child(this._tasks);

        // agents elsewhere (a terminal)
        this._elsewhereHeader = menuHeader('Also working');
        root.add_child(this._elsewhereHeader);
        this._elsewhere = menuCard();
        root.add_child(this._elsewhere);

        const open = new St.BoxLayout({style_class: 'osmin-chips-row', x_expand: true});
        open.add_child(menuChip({label: 'Open the agents window', icon: 'view-list-symbolic', onClick: () => this._open({})}));
        root.add_child(open);

        this._agents.connectObject('changed', () => this._rebuild(), this);
        return root;
    }

    onViewCreated() {
        this._rebuild();
    }

    onPageShown() {
        this._agents.refreshUsage();
        this._rebuild();
    }

    _open(args) {
        this._agents.openWindow(args);
        this.context.ui?.closeCapsule?.();
    }

    async _start(where) {
        const prompt = this._entry.text.trim();
        if (!this._project) {
            this._say('Choose a project first (or More… for any folder).');
            return;
        }
        if (!prompt && where === 'background') {
            this._say('Write what Claude should do.');
            return;
        }
        try {
            const result = await this._agents.startTask({cwd: this._project, prompt, where});
            this._entry.text = '';
            this._say(result.terminal ? `Opened in ${result.terminal}` : '');
        } catch (e) {
            this._say(String(e.message ?? e).replace(/^GDBus\.Error:[^ ]+ /, ''));
        }
    }

    _say(text) {
        this._note.text = text;
        this._note.visible = !!text;
    }

    _rebuild() {
        if (!this._view)
            return;
        this._rebuildUsage();
        this._rebuildProjects();
        this._rebuildTasks();
        this._rebuildElsewhere();
    }

    _rebuildUsage() {
        const card = this._usageCard;
        card.destroy_all_children();
        const usage = this._agents.usage;
        const claude = this._agents.agents.find(a => a.id === 'claude');
        const head = new St.BoxLayout({style_class: 'osmin-value-row osmin-agent-usage-head', x_expand: true});
        const plan = usage.plan ? ` · ${usage.plan[0].toUpperCase()}${usage.plan.slice(1)}` : '';
        head.add_child(new St.Label({text: `Claude${plan}`, style_class: 'osmin-value-label osmin-value-strong', x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
        if (claude?.tokens5h)
            head.add_child(new St.Label({text: `${compact(claude.tokens5h)} tokens in 5 h`, style_class: 'osmin-value-muted', y_align: Clutter.ActorAlign.CENTER}));
        card.add_child(head);
        if (!usage.available) {
            card.add_child(new St.Label({text: usage.problem || (this._agents.claudeInstalled ? 'Limits not known yet' : 'Claude Code is not installed'), style_class: 'osmin-hint'}));
            return;
        }
        for (const [name, window] of [['5 hours', usage.fiveHour], ['Week', usage.sevenDay]]) {
            if (!window)
                continue;
            const line = new St.BoxLayout({style_class: 'osmin-value-row', x_expand: true});
            line.add_child(new St.Label({text: name, style_class: 'osmin-value-label osmin-agent-window', y_align: Clutter.ActorAlign.CENTER}));
            const bar = usageBar();
            bar.actor.y_align = Clutter.ActorAlign.CENTER;
            line.add_child(bar.actor);
            line.add_child(new St.Label({text: `${Math.round(window.percent)}%`, style_class: 'osmin-meter-percent', y_align: Clutter.ActorAlign.CENTER}));
            card.add_child(line);
            card.add_child(new St.Label({text: `starts again in ${until(window.resetsAt)}`, style_class: 'osmin-value-muted osmin-agent-reset'}));
            bar.set(window.percent / 100, window.percent >= 85);
        }
    }

    _rebuildProjects() {
        this._projects.destroy_all_children();
        const all = this._agents.projects;
        if (!this._project && all[0])
            this._project = all[0].path;
        // the chosen project always shows, first
        const chosen = all.find(p => p.path === this._project) ?? (this._project ? {path: this._project, name: this._project.split('/').pop()} : null);
        const projects = [chosen, ...all.filter(p => p.path !== this._project)].filter(Boolean).slice(0, 3);
        if (!projects.length) {
            this._projects.add_child(new St.Label({text: 'No recent projects: More… to choose a folder', style_class: 'osmin-hint'}));
            return;
        }
        for (const project of projects) {
            const chip = menuChip({label: project.name, icon: 'folder-symbolic', onClick: () => {
                this._project = project.path;
                this._rebuildProjects();
            }});
            setChecked(chip, project.path === this._project);
            this._projects.add_child(chip);
        }
    }

    _rebuildTasks() {
        this._tasks.destroy_all_children();
        const tasks = this._agents.tasks.slice(0, 5);
        this._tasksHeader.visible = tasks.length > 0;
        for (const task of tasks)
            this._tasks.add_child(this._taskCard(task));
    }

    _taskCard(task) {
        const card = menuCard();
        card.add_style_class_name('osmin-agent-task');
        const row = new St.BoxLayout({style_class: 'osmin-agent osmin-card-row', x_expand: true});
        const dot = new St.Widget({style_class: `osmin-agent-dot ${task.status}${task.running ? ' working' : ''}`, y_align: Clutter.ActorAlign.START});
        row.add_child(dot);
        const texts = new St.BoxLayout({vertical: true, x_expand: true});
        const title = new St.Label({text: `${task.project} · ${STATUS_TEXT[task.status] ?? task.status}`, style_class: 'osmin-agent-name'});
        texts.add_child(title);
        const prompt = new St.Label({text: task.prompt, style_class: 'osmin-agent-status'});
        prompt.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        texts.add_child(prompt);
        const busy = task.running && (task.status === 'working' || task.status === 'starting' || task.status === 'waiting');
        const now = busy ? task.current : [ago(task.lastAt), money(task.costUsd)].filter(Boolean).join(' · ');
        const current = new St.Label({text: now || '', style_class: 'osmin-agent-current'});
        current.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        texts.add_child(current);
        row.add_child(texts);
        card.add_child(row);

        for (const request of task.pending ?? []) {
            card.add_child(menuDivider());
            const ask = new St.BoxLayout({vertical: true, style_class: 'osmin-card-pad osmin-agent-ask', x_expand: true});
            const what = new St.Label({text: `Wants to: ${request.verb} ${request.detail}`.trim(), style_class: 'osmin-agent-ask-text'});
            what.clutter_text.line_wrap = true;
            ask.add_child(what);
            const buttons = new St.BoxLayout({style_class: 'osmin-chips-row', x_expand: true});
            buttons.add_child(menuChip({label: 'Allow', primary: true, onClick: () => this._agents.answer(task.id, request.requestId, 'allow')}));
            buttons.add_child(menuChip({label: 'Always', onClick: () => this._agents.answer(task.id, request.requestId, 'always')}));
            buttons.add_child(menuChip({label: 'Deny', onClick: () => this._agents.answer(task.id, request.requestId, 'deny')}));
            ask.add_child(buttons);
            card.add_child(ask);
        }

        const actions = new St.BoxLayout({style_class: 'osmin-card-pad osmin-agent-actions', x_expand: true});
        actions.add_child(pillButton({label: 'Open', icon: 'view-reveal-symbolic', onClick: () => this._open({id: task.id})}));
        if (task.running)
            actions.add_child(pillButton({label: 'Stop', icon: 'media-playback-stop-symbolic', onClick: () => this._agents.stop(task.id)}));
        else
            actions.add_child(pillButton({label: 'Remove', icon: 'user-trash-symbolic', onClick: () => this._agents.remove(task.id)}));
        card.add_child(actions);
        return card;
    }

    _rebuildElsewhere() {
        this._elsewhere.destroy_all_children();
        const working = this._agents.agents.filter(a => a.installed && a.working.length);
        this._elsewhereHeader.visible = this._elsewhere.visible = working.length > 0;
        for (const agent of working) {
            const row = new St.BoxLayout({style_class: 'osmin-agent osmin-card-row', x_expand: true});
            row.add_child(new St.Widget({style_class: 'osmin-agent-dot working', y_align: Clutter.ActorAlign.CENTER}));
            const texts = new St.BoxLayout({vertical: true, x_expand: true});
            texts.add_child(new St.Label({text: agent.name, style_class: 'osmin-agent-name'}));
            texts.add_child(new St.Label({text: `Working · ${agent.working.map(w => w.project).join(', ')}`, style_class: 'osmin-agent-status'}));
            row.add_child(texts);
            this._elsewhere.add_child(row);
        }
    }

    destroy() {
        this._agents.disconnectObject(this);
        super.destroy();
    }
}
