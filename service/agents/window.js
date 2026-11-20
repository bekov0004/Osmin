import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';

/**
 * The agents window of the Osmin app. On the left the tasks (and the plan's limits); on the right what the chosen task
 * does, live: its messages, every file it reads or edits and every command it runs, its questions about permissions
 * (Allow / Always / Deny), and a field to tell it more. "New task" asks for a project folder, what to do, and where to
 * run it (in the background, followed here, or in a terminal).
 */

const MODELS = [['', 'Default model'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku (fast, light)']];

const STATUS = {
    starting: ['content-loading-symbolic', 'Starting'], working: ['media-playback-start-symbolic', 'Working'],
    waiting: ['dialog-question-symbolic', 'Needs you'], idle: ['emblem-ok-symbolic', 'Done, waiting for more'],
    done: ['emblem-ok-symbolic', 'Done'], failed: ['dialog-error-symbolic', 'Failed'], stopped: ['media-playback-stop-symbolic', 'Stopped'],
};

const CSS = `
.agent-bubble { background: alpha(@accent_bg_color, 0.18); border-radius: 12px; padding: 8px 12px; }
.agent-text { padding: 2px 4px; }
.agent-tool { padding: 2px 4px; }
.agent-tool-ok { color: @success_color; }
.agent-tool-error { color: @error_color; }
.agent-output { font-family: monospace; font-size: 0.85em; background: alpha(@view_fg_color, 0.06); border-radius: 8px; padding: 6px 8px; }
.agent-result { background: alpha(@success_bg_color, 0.15); border-radius: 12px; padding: 8px 12px; }
.agent-result-error { background: alpha(@error_bg_color, 0.15); }
.agent-permission { background: alpha(@warning_bg_color, 0.22); border-radius: 14px; padding: 12px; }
.agent-note { font-size: 0.85em; }
.agent-usage-bar trough { min-height: 6px; }
`;

const ago = ms => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60)
        return `${s} s`;
    if (s < 3600)
        return `${Math.floor(s / 60)} min`;
    return `${Math.floor(s / 3600)} h ${Math.floor(s / 60) % 60} min`;
};

const until = ms => {
    const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
    if (m < 60)
        return `${m} min`;
    if (m < 48 * 60)
        return `${Math.floor(m / 60)} h ${m % 60} min`;
    return `${Math.floor(m / 1440)} d`;
};

const money = usd => (usd >= 0.01 ? `$${usd.toFixed(2)}` : usd > 0 ? '<$0.01' : '');

function label(text, {classes = [], wrap = true, xalign = 0, selectable = false, ellipsize = false, lines = 0} = {}) {
    const l = new Gtk.Label({label: text, xalign, wrap, wrap_mode: Pango.WrapMode.WORD_CHAR, selectable, css_classes: classes});
    if (ellipsize) {
        l.ellipsize = Pango.EllipsizeMode.END;
        l.wrap = false;
    }
    if (lines)
        l.lines = lines;
    return l;
}

export function createAgentsWindow(module) {
    GLib.set_prgname('dev.osmin.Osmin');
    Adw.init();
    const provider = new Gtk.CssProvider();
    provider.load_from_string(CSS);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

    const window = new Adw.Window({title: 'Osmin Agents', default_width: 980, default_height: 680});
    const split = new Adw.NavigationSplitView({min_sidebar_width: 280, max_sidebar_width: 340});

    // --- sidebar: tasks and limits -------------------------------------------------------------------------
    const sideToolbar = new Adw.ToolbarView();
    const sideHeader = new Adw.HeaderBar({show_title: true, title_widget: new Adw.WindowTitle({title: 'Agents'})});
    const newButton = Gtk.Button.new_from_icon_name('list-add-symbolic');
    newButton.tooltip_text = 'New task';
    sideHeader.pack_start(newButton);
    sideToolbar.add_top_bar(sideHeader);
    const sideBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    const list = new Gtk.ListBox({css_classes: ['navigation-sidebar'], selection_mode: Gtk.SelectionMode.SINGLE});
    const listScroll = new Gtk.ScrolledWindow({child: list, vexpand: true, hscrollbar_policy: Gtk.PolicyType.NEVER});
    sideBox.append(listScroll);
    const usageBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_start: 14, margin_end: 14, margin_top: 10, margin_bottom: 14});
    sideBox.append(new Gtk.Separator());
    sideBox.append(usageBox);
    sideToolbar.set_content(sideBox);
    split.sidebar = new Adw.NavigationPage({title: 'Agents', child: sideToolbar});

    // --- content -----------------------------------------------------------------------------------------------
    const contentToolbar = new Adw.ToolbarView();
    const contentHeader = new Adw.HeaderBar();
    const contentTitle = new Adw.WindowTitle({title: '', subtitle: ''});
    contentHeader.title_widget = contentTitle;
    const stopButton = new Gtk.Button({label: 'Stop', css_classes: ['destructive-action']});
    const interruptButton = new Gtk.Button({icon_name: 'media-playback-pause-symbolic', tooltip_text: 'Stop what it is doing now (the task stays)'});
    const folderButton = new Gtk.Button({icon_name: 'folder-open-symbolic', tooltip_text: 'Open the project folder'});
    const removeButton = new Gtk.Button({icon_name: 'user-trash-symbolic', tooltip_text: 'Remove from the list'});
    contentHeader.pack_end(removeButton);
    contentHeader.pack_end(stopButton);
    contentHeader.pack_end(interruptButton);
    contentHeader.pack_start(folderButton);
    contentToolbar.add_top_bar(contentHeader);
    const stack = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
    contentToolbar.set_content(stack);
    split.content = new Adw.NavigationPage({title: 'Task', child: contentToolbar});

    // empty
    stack.add_named(new Adw.StatusPage({icon_name: 'system-run-symbolic', title: 'No task chosen',
        description: 'Start a new task with +, or pick one on the left.'}), 'empty');

    // task view
    const taskBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
    const permissionBox = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, margin_start: 16, margin_end: 16, margin_top: 12, visible: false});
    taskBox.append(permissionBox);
    const transcript = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10, margin_start: 18, margin_end: 18, margin_top: 14, margin_bottom: 14});
    const transcriptScroll = new Gtk.ScrolledWindow({child: transcript, vexpand: true, hscrollbar_policy: Gtk.PolicyType.NEVER});
    taskBox.append(transcriptScroll);
    const inputRow = new Gtk.Box({spacing: 8, margin_start: 16, margin_end: 16, margin_top: 8, margin_bottom: 14});
    const input = new Gtk.Entry({hexpand: true, placeholder_text: 'Tell Claude more, or ask it to change something…'});
    const sendButton = new Gtk.Button({icon_name: 'mail-send-symbolic', css_classes: ['suggested-action'], tooltip_text: 'Send'});
    inputRow.append(input);
    inputRow.append(sendButton);
    taskBox.append(new Gtk.Separator());
    taskBox.append(inputRow);
    stack.add_named(taskBox, 'task');

    // new task
    const form = buildNewTask(module, window, ({id, terminal}) => {
        if (id)
            show({id});
        else if (terminal)
            showToast(`Opened in ${terminal}`);
    }, text => showToast(text));
    stack.add_named(form.widget, 'new');

    const toasts = new Adw.ToastOverlay({child: split});
    window.content = toasts;
    const showToast = text => toasts.add_toast(new Adw.Toast({title: text, timeout: 4}));

    // --- behaviour -------------------------------------------------------------------------------------------
    let current = '';                 // the task shown
    let shown = [];                   // transcript entries shown (the objects themselves)
    const rows = new Map();           // entry -> refresh()

    const call = async (method, args) => {
        try {
            return await module.dispatch(method, args);
        } catch (e) {
            showToast(e.message);
            return null;
        }
    };

    newButton.connect('clicked', () => show({newTask: true}));
    stopButton.connect('clicked', () => current && call('stop', {id: current}));
    interruptButton.connect('clicked', () => current && call('interrupt', {id: current}));
    removeButton.connect('clicked', () => {
        if (!current)
            return;
        call('remove', {id: current});
        current = '';
        stack.visible_child_name = 'empty';
        refresh();
    });
    folderButton.connect('clicked', () => {
        const task = module.task(current);
        if (task)
            Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(task.cwd).get_uri(), null);
    });
    const send = () => {
        const text = input.text.trim();
        if (!text || !current)
            return;
        input.text = '';
        call('send', {id: current, text});
    };
    input.connect('activate', send);
    sendButton.connect('clicked', send);
    list.connect('row-activated', (_l, row) => row._id && show({id: row._id}));

    function show({id = '', newTask = false} = {}) {
        window.present();
        if (newTask || !id) {
            if (newTask || !module.state.tasks.length) {
                current = '';
                form.reset();
                stack.visible_child_name = 'new';
                contentTitle.title = 'New task';
                contentTitle.subtitle = '';
                for (const b of [stopButton, interruptButton, removeButton, folderButton])
                    b.visible = false;
                split.show_content = true;
                return;
            }
            id = module.state.tasks[0].id;
        }
        current = id;
        shown = [];
        rows.clear();
        let child = transcript.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            transcript.remove(child);
            child = next;
        }
        stack.visible_child_name = 'task';
        split.show_content = true;
        refresh();
        input.grab_focus();
    }

    function refresh() {
        const state = module.state;
        renderList(list, state.tasks, current);
        renderUsage(usageBox, state.usage, state.tasks);
        const task = module.task(current);
        if (!task || stack.visible_child_name !== 'task')
            return;
        const s = task.summary;
        contentTitle.title = `${s.project} · ${(STATUS[s.status] ?? STATUS.working)[1]}`;
        contentTitle.subtitle = [s.current && s.running ? s.current : '', money(s.costUsd), s.model].filter(Boolean).join(' · ');
        stopButton.visible = s.running;
        interruptButton.visible = s.running && (s.status === 'working' || s.status === 'waiting');
        removeButton.visible = !s.running;
        folderButton.visible = true;
        input.placeholder_text = s.running ? 'Tell Claude more, or ask it to change something…' : 'Continue this task…';
        renderPermissions(permissionBox, task, (requestId, decision) => call('answer', {id: task.id, requestId, decision}));

        // new lines, and the tool lines whose result came in
        const adjustment = transcriptScroll.vadjustment;
        const atBottom = adjustment.value + adjustment.page_size >= adjustment.upper - 40;
        for (const entry of task.transcript) {
            if (rows.has(entry)) {
                rows.get(entry)();
                continue;
            }
            const {widget, refresh: update} = renderEntry(entry, task);
            transcript.append(widget);
            rows.set(entry, update);
            shown.push(entry);
        }
        if (atBottom)
            GLib.idle_add(GLib.PRIORITY_LOW, () => {
                adjustment.value = adjustment.upper;
                return GLib.SOURCE_REMOVE;
            });
    }

    const stopListening = module.addListener(() => refresh());
    const ticker = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15, () => {
        refresh();
        return GLib.SOURCE_CONTINUE;
    });
    return {
        window,
        show,
        destroy() {
            stopListening();
            GLib.source_remove(ticker);
        },
    };
}

function renderList(list, tasks, current) {
    let child = list.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        list.remove(child);
        child = next;
    }
    if (!tasks.length) {
        const row = new Gtk.ListBoxRow({selectable: false, activatable: false});
        row.child = label('No tasks yet. Press + to start one.', {classes: ['dim-label'], xalign: 0.5});
        row.child.margin_top = row.child.margin_bottom = 20;
        list.append(row);
        return;
    }
    for (const t of tasks) {
        const row = new Gtk.ListBoxRow();
        row._id = t.id;
        const box = new Gtk.Box({spacing: 10, margin_top: 8, margin_bottom: 8, margin_start: 6, margin_end: 6});
        const [icon] = STATUS[t.status] ?? STATUS.working;
        const image = new Gtk.Image({icon_name: icon, valign: Gtk.Align.START, margin_top: 2});
        if (t.status === 'waiting')
            image.add_css_class('warning');
        else if (t.status === 'failed')
            image.add_css_class('error');
        else if (t.running)
            image.add_css_class('accent');
        box.append(image);
        const texts = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, hexpand: true});
        texts.append(label(t.project, {classes: ['heading'], ellipsize: true}));
        texts.append(label(t.prompt, {classes: ['dim-label', 'caption'], ellipsize: true}));
        const line = t.status === 'waiting' ? 'Needs you to allow something' : t.running ? t.current : `${(STATUS[t.status] ?? STATUS.done)[1]} · ${ago(t.lastAt)} ago`;
        texts.append(label(line, {classes: ['caption'], ellipsize: true}));
        box.append(texts);
        row.child = box;
        list.append(row);
        if (t.id === current)
            list.select_row(row);
    }
}

function renderUsage(box, usage, tasks) {
    let child = box.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        box.remove(child);
        child = next;
    }
    const title = new Gtk.Box({spacing: 6});
    title.append(label(`Claude${usage?.plan ? ` · ${usage.plan[0].toUpperCase()}${usage.plan.slice(1)} plan` : ''}`, {classes: ['heading']}));
    box.append(title);
    if (!usage?.available) {
        box.append(label(usage?.problem || 'Limits not known yet', {classes: ['dim-label', 'caption']}));
    } else {
        for (const [name, window] of [['5 hours', usage.fiveHour], ['Week', usage.sevenDay]]) {
            if (!window)
                continue;
            const head = new Gtk.Box();
            head.append(label(name, {classes: ['caption']}));
            const right = label(`${Math.round(window.percent)}% · resets in ${until(window.resetsAt)}`, {classes: ['caption', 'dim-label'], xalign: 1});
            right.hexpand = true;
            head.append(right);
            box.append(head);
            const bar = new Gtk.LevelBar({min_value: 0, max_value: 100, value: Math.min(100, window.percent), css_classes: ['agent-usage-bar']});
            box.append(bar);
        }
    }
    const spent = tasks.reduce((sum, t) => sum + (t.costUsd ?? 0), 0);
    if (spent > 0)
        box.append(label(`These tasks: ${money(spent)} (API prices)`, {classes: ['dim-label', 'caption']}));
}

function renderPermissions(box, task, answer) {
    let child = box.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        box.remove(child);
        child = next;
    }
    box.visible = task.pending.length > 0;
    for (const request of task.pending) {
        const card = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, css_classes: ['agent-permission']});
        card.append(label(`Claude wants to: ${request.verb}`, {classes: ['heading']}));
        if (request.detail)
            card.append(label(request.detail, {classes: ['agent-output'], selectable: true}));
        if (request.description && request.description !== request.detail)
            card.append(label(request.description, {classes: ['dim-label', 'caption']}));
        const buttons = new Gtk.Box({spacing: 8, halign: Gtk.Align.END});
        const deny = new Gtk.Button({label: 'Deny'});
        const always = new Gtk.Button({label: 'Always in this task'});
        const allow = new Gtk.Button({label: 'Allow', css_classes: ['suggested-action']});
        deny.connect('clicked', () => answer(request.requestId, 'deny'));
        always.connect('clicked', () => answer(request.requestId, 'always'));
        allow.connect('clicked', () => answer(request.requestId, 'allow'));
        buttons.append(deny);
        if (request.suggestions?.length)
            buttons.append(always);
        buttons.append(allow);
        card.append(buttons);
        box.append(card);
    }
}

function renderEntry(entry) {
    let widget;
    let refresh = () => {};
    switch (entry.kind) {
    case 'user': {
        widget = new Gtk.Box({halign: Gtk.Align.END, css_classes: ['agent-bubble']});
        widget.append(label(entry.text, {selectable: true}));
        widget.margin_start = 80;
        break;
    }
    case 'text':
        widget = label(entry.text, {classes: ['agent-text'], selectable: true});
        break;
    case 'tool': {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4, css_classes: ['agent-tool']});
        const head = new Gtk.Box({spacing: 8});
        const icon = new Gtk.Image({icon_name: 'content-loading-symbolic', valign: Gtk.Align.START});
        head.append(icon);
        head.append(label(entry.text, {classes: ['dim-label'], ellipsize: false}));
        box.append(head);
        const expander = new Gtk.Expander({label: 'Output', visible: false});
        const output = label('', {classes: ['agent-output'], selectable: true});
        expander.child = output;
        box.append(expander);
        refresh = () => {
            if (entry.ok === undefined)
                return;
            icon.icon_name = entry.ok ? 'emblem-ok-symbolic' : 'dialog-error-symbolic';
            icon.css_classes = [entry.ok ? 'agent-tool-ok' : 'agent-tool-error'];
            if (entry.output) {
                output.label = entry.output;
                expander.visible = true;
            }
        };
        refresh();
        widget = box;
        break;
    }
    case 'result':
        widget = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4, css_classes: entry.ok ? ['agent-result'] : ['agent-result', 'agent-result-error']});
        widget.append(label(entry.ok ? 'Done' : 'Stopped with an error', {classes: ['heading']}));
        if (entry.text)
            widget.append(label(entry.text, {selectable: true}));
        break;
    case 'error':
        widget = label(entry.text, {classes: ['error'], selectable: true});
        break;
    default:
        widget = label(entry.text ?? '', {classes: ['dim-label', 'agent-note']});
        break;
    }
    return {widget, refresh};
}

/** The "New task" form. @param onStarted ({id}|{terminal}) */
function buildNewTask(module, window, onStarted, onError) {
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({title: 'New task', description: 'Claude Code works in the project folder you choose. In the background you follow it here and answer its questions; in a terminal it is the usual Claude Code.'});
    page.add(group);

    // project
    let folder = '';
    const folderRow = new Adw.ActionRow({title: 'Project folder', subtitle: 'Not chosen'});
    const recent = new Gtk.MenuButton({icon_name: 'document-open-recent-symbolic', valign: Gtk.Align.CENTER, tooltip_text: 'Recent projects'});
    const chooseButton = new Gtk.Button({label: 'Choose…', valign: Gtk.Align.CENTER});
    folderRow.add_suffix(recent);
    folderRow.add_suffix(chooseButton);
    group.add(folderRow);
    const setFolder = path => {
        folder = path;
        folderRow.subtitle = path || 'Not chosen';
    };
    chooseButton.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({title: 'Project folder', modal: true});
        if (folder)
            dialog.initial_folder = Gio.File.new_for_path(folder);
        dialog.select_folder(window, null, (_d, result) => {
            try {
                setFolder(dialog.select_folder_finish(result)?.get_path() ?? folder);
            } catch (e) {
                // cancelled
            }
        });
    });
    const fillRecent = () => {
        const popover = new Gtk.Popover();
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, margin_top: 6, margin_bottom: 6, margin_start: 6, margin_end: 6});
        const projects = module.state.projects ?? [];
        if (!projects.length)
            box.append(label('No recent projects', {classes: ['dim-label']}));
        for (const project of projects) {
            const button = new Gtk.Button({css_classes: ['flat']});
            const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
            content.append(label(project.name, {classes: ['heading']}));
            content.append(label(project.path, {classes: ['dim-label', 'caption']}));
            button.child = content;
            button.connect('clicked', () => {
                setFolder(project.path);
                popover.popdown();
            });
            box.append(button);
        }
        popover.child = box;
        recent.popover = popover;
    };
    fillRecent();

    // what to do
    const promptGroup = new Adw.PreferencesGroup({title: 'What should it do?'});
    page.add(promptGroup);
    const promptView = new Gtk.TextView({wrap_mode: Gtk.WrapMode.WORD_CHAR, top_margin: 10, bottom_margin: 10, left_margin: 10, right_margin: 10, height_request: 140});
    const promptFrame = new Gtk.Frame({child: promptView, css_classes: ['view']});
    promptGroup.add(promptFrame);

    // how
    const howGroup = new Adw.PreferencesGroup({title: 'How'});
    page.add(howGroup);
    const agentRow = new Adw.ComboRow({title: 'Agent', model: Gtk.StringList.new(['Claude Code', 'Codex'])});
    howGroup.add(agentRow);
    const whereRow = new Adw.ComboRow({title: 'Where', subtitle: 'Background: followed here, questions answered from Osmin',
        model: Gtk.StringList.new(['In the background', 'In a terminal'])});
    howGroup.add(whereRow);
    const modelRow = new Adw.ComboRow({title: 'Model', model: Gtk.StringList.new(MODELS.map(m => m[1]))});
    howGroup.add(modelRow);
    agentRow.connect('notify::selected', () => {
        const codex = agentRow.selected === 1;
        whereRow.sensitive = modelRow.sensitive = !codex;
        if (codex)
            whereRow.selected = 1;
    });

    const startButton = new Gtk.Button({label: 'Start', css_classes: ['suggested-action', 'pill'], halign: Gtk.Align.CENTER, margin_top: 12});
    const buttonGroup = new Adw.PreferencesGroup();
    buttonGroup.add(startButton);
    page.add(buttonGroup);
    startButton.connect('clicked', async () => {
        const buffer = promptView.buffer;
        const prompt = buffer.get_text(buffer.get_start_iter(), buffer.get_end_iter(), false).trim();
        try {
            const result = await module.dispatch('startTask', {
                cwd: folder, prompt,
                agent: agentRow.selected === 1 ? 'codex' : 'claude',
                where: whereRow.selected === 1 ? 'terminal' : 'background',
                model: MODELS[modelRow.selected]?.[0] ?? '',
            });
            buffer.text = '';
            onStarted(result);
        } catch (e) {
            onError(e.message);
        }
    });

    return {
        widget: page,
        reset() {
            fillRecent();
            if (!folder && module.state.projects?.[0])
                setFolder(module.state.projects[0].path);
            const codex = !!module.state.codex;
            agentRow.visible = codex;
            promptView.grab_focus();
        },
    };
}
