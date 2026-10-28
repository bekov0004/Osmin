import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {calculate, convert, formatNumber, matchScore} from './engine.js';

const MAX_APPS = 5;

/** {date}, {time} and {datetime} in a snippet's text. */
function expandSnippet(text) {
    const now = new Date();
    const two = n => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
    const time = `${two(now.getHours())}:${two(now.getMinutes())}`;
    return text.replaceAll('{datetime}', `${date} ${time}`).replaceAll('{date}', date).replaceAll('{time}', time);
}
const MAX_CLIPS = 3;

/**
 * The command bar (the "Search" tab): one field for everything. Type to launch an application, to
 * calculate ("12*(3+4)"), to convert units ("5 km to mi"), to find something you copied, or to
 * search the web. Up / Down choose, Enter does it, Esc clears and leaves.
 */
export class CommandView extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminCommandView'}, this);
    }

    /**
     * @param {{clipboard: ClipboardService, ui: {beginTextInput, endTextInput}, onDone: () => void,
     *          onPaste: (item) => void}} params
     */
    constructor({clipboard, ui, onDone, onPaste, onPasteText = null, processes = null, service = null, snippets = null}) {
        super({vertical: true, style_class: 'osmin-tray osmin-clipboard', x_expand: true, y_expand: true});
        this._clipboardService = clipboard;
        this._ui = ui;
        this._onDone = onDone;
        this._onPaste = onPaste;
        this._processes = processes;
        this._service = service;
        this._snippetsModule = snippets;
        this._onPasteText = onPasteText;
        this._searchId = 0;
        this._typing = false;
        this._results = [];
        this._selected = 0;

        this._bar = new St.BoxLayout({style_class: 'osmin-clip-bar', x_expand: true});
        this._entry = new St.Entry({hint_text: 'Search apps, calculate, convert units, find what you copied…', style_class: 'osmin-clip-entry', can_focus: true, x_expand: true});
        this._entry.set_primary_icon(new St.Icon({icon_name: 'system-search-symbolic', style_class: 'osmin-clip-find'}));
        const text = this._entry.clutter_text;
        text.connect('text-changed', () => this._search());
        text.connect('activate', () => this._run(this._selected));
        text.connect('key-press-event', (_actor, event) => this._onKey(event));
        text.connect('key-focus-in', () => this._startTyping());
        this._bar.add_child(this._entry);
        this.add_child(this._bar);

        this._scroll = new St.ScrollView({
            style_class: 'osmin-tray-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        this._list = new St.BoxLayout({vertical: true, style_class: 'osmin-clip-list', x_expand: true});
        this._scroll.add_child(this._list);
        this.add_child(this._scroll);
        this._search();
    }

    get scrollTargets() {
        return [{scroll: this._scroll, list: this._list}];
    }

    /** The tab was opened: the field gets the keyboard. */
    focusEntry() {
        this._entry.grab_key_focus();
    }

    _startTyping() {
        if (this._typing)
            return;
        this._typing = true;
        this._ui.beginTextInput(() => this.stopTyping(true));
        this._entry.grab_key_focus();
    }

    /** The tab was left or the capsule closed. */
    stopTyping(fromHost = false) {
        if (!this._typing)
            return;
        this._typing = false;
        if (!fromHost)
            this._ui.endTextInput();
    }

    destroy() {
        this.stopTyping();
        super.destroy();
    }

    _onKey(event) {
        switch (event.get_key_symbol()) {
        case Clutter.KEY_Down:
            this._select(this._selected + 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._select(this._selected - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Escape:
            if (this._entry.text)
                this._entry.text = '';
            else
                this._onDone();
            return Clutter.EVENT_STOP;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _select(index) {
        if (this._results.length === 0)
            return;
        this._selected = (index + this._results.length) % this._results.length;
        this._render();
    }

    /** Fills the list for what is typed. */
    _search() {
        const query = this._entry.text.trim();
        const results = [];
        const stop = query.match(/^(?:kill|stop|quit)\s+(.+)$/i);
        if (stop || /^ports?$/i.test(query)) {
            this._searchProcesses(stop ? stop[1] : null);
            return;
        }
        this._searchId++;
        const snippetRows = this._snippetRows(query);
        if (snippetRows) {
            this._results = snippetRows;
            this._selected = 0;
            this._render();
            return;
        }
        if (query) {
            const sum = calculate(query);
            if (sum !== null) {
                results.push({icon: 'accessories-calculator-symbolic', title: `= ${formatNumber(sum)}`, subtitle: 'Press Enter to copy the result', run: () => this._copy(formatNumber(sum))});
            }
            const converted = convert(query);
            if (converted)
                results.push({icon: 'applications-science-symbolic', title: converted.text, subtitle: 'Press Enter to copy the result', run: () => this._copy(formatNumber(Math.round(converted.value * 1e6) / 1e6))});
            if (/^(scratch|scratchpad|notes?)$/i.test(query) && this._service) {
                results.push({
                    icon: 'document-edit-symbolic',
                    title: 'Open the Scratchpad',
                    subtitle: 'Notes of any length, saved as you type',
                    run: () => this._service.call('openScratchpad').catch(e => console.warn(`[osmin] ${e.message}`)),
                });
            }
            results.push(...this._apps(query));
            results.push(...this._clips(query));
            results.push({
                icon: 'web-browser-symbolic',
                title: `Search the web for “${query}”`,
                subtitle: 'DuckDuckGo',
                run: () => Gio.AppInfo.launch_default_for_uri_async(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, null, null, null),
            });
        }
        this._results = results;
        this._selected = 0;
        this._render();
    }

    /**
     * ";trigger" lists the snippets that start with it (Enter pastes the text where you were);
     * "snip add ;trigger = text" adds one, "snip rm ;trigger" removes one, "snippets" lists them all.
     * Variables in a text: {date} {time} {datetime}.
     * @returns {object[]|null} rows, or null when the query is not about snippets
     */
    _snippetRows(query) {
        if (!this._snippetsModule)
            return null;
        const add = query.match(/^snip(?:pet)?\s+add\s+(\S+)\s*=\s*([\s\S]+)$/i);
        if (add) {
            return [{icon: 'list-add-symbolic', title: `Add snippet ${add[1]}`, subtitle: add[2].slice(0, 60),
                run: () => this._snippetsModule.call('add', {trigger: add[1], text: add[2]}).catch(e => console.warn(`[osmin] ${e.message}`))}];
        }
        const remove = query.match(/^snip(?:pet)?\s+(?:rm|remove|delete)\s+(\S+)$/i);
        if (remove) {
            return [{icon: 'user-trash-symbolic', title: `Remove snippet ${remove[1]}`, subtitle: 'Press Enter',
                run: () => this._snippetsModule.call('remove', {trigger: remove[1]}).catch(e => console.warn(`[osmin] ${e.message}`))}];
        }
        const all = /^snip(?:pet)?s?$/i.test(query);
        if (!all && !query.startsWith(';'))
            return null;
        const list = this._snippetsModule.state.snippets ?? [];
        const rows = list.filter(s => all || s.trigger.toLowerCase().startsWith(query.toLowerCase())).slice(0, 8).map(s => ({
            icon: 'insert-text-symbolic',
            title: s.trigger,
            subtitle: s.text.replace(/\s+/g, ' ').slice(0, 70),
            run: () => this._onPasteText?.(expandSnippet(s.text)),
        }));
        if (rows.length === 0) {
            rows.push({icon: 'dialog-information-symbolic', title: 'No snippet like that', subtitle: 'Add one: snip add ;mail = me@example.com', run: () => {}});
        }
        return rows;
    }

    /** "kill <name>" lists your processes of that name, "ports" the ports they listen on; Enter twice stops one. */
    async _searchProcesses(name) {
        const id = ++this._searchId;
        let results = [];
        try {
            if (name === null) {
                const {ports} = await this._processes.call('ports');
                results = ports.map(entry => this._stopRow(entry.pid, `Port ${entry.port} · ${entry.name}`, `${entry.protocol} · process ${entry.pid}`));
            } else {
                const {processes} = await this._processes.call('list', {query: name});
                results = processes.map(entry => this._stopRow(entry.pid, entry.name, `process ${entry.pid} · ${Math.round(entry.memory / 1048576)} MB`));
            }
        } catch (e) {
            results = [{icon: 'dialog-warning-symbolic', title: e.message, subtitle: '', run: () => {}}];
        }
        if (id !== this._searchId)
            return;
        this._results = results;
        this._selected = 0;
        this._render();
    }

    _stopRow(pid, title, subtitle) {
        return {
            icon: 'process-stop-symbolic',
            title,
            subtitle: `${subtitle} · Enter, then Enter again to stop it`,
            confirm: true,
            run: () => this._processes.call('stop', {pid}).catch(e => console.warn(`[osmin] stop ${pid}: ${e.message}`)),
        };
    }

    _apps(query) {
        let apps = [];
        try {
            apps = Shell.AppSystem.get_default().get_installed();
        } catch (e) {
            return [];
        }
        return apps
            .filter(app => app.should_show())
            .map(app => {
                const keywords = app.get_keywords?.();
                const words = Array.isArray(keywords) ? keywords.join(' ') : String(keywords ?? '');
                return {app, score: Math.max(matchScore(app.get_name() ?? '', query), matchScore(app.get_generic_name() ?? '', query) / 2, matchScore(words, query) / 3)};
            })
            .filter(entry => entry.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_APPS)
            .map(({app}) => ({
                icon: null,
                gicon: app.get_icon(),
                title: app.get_name(),
                subtitle: app.get_description() ?? 'Application',
                run: () => {
                    const shellApp = Shell.AppSystem.get_default().lookup_app(app.get_id());
                    if (shellApp)
                        shellApp.activate();
                    else
                        app.launch([], null);
                },
            }));
    }

    _clips(query) {
        const q = query.toLowerCase();
        if (q.length < 2)
            return [];
        return this._clipboardService.items
            .filter(item => item.text.toLowerCase().includes(q))
            .slice(0, MAX_CLIPS)
            .map(item => ({
                icon: 'edit-paste-symbolic',
                title: item.files?.length ? item.files[0].split('/').pop() : item.text.replace(/\s+/g, ' ').slice(0, 80),
                subtitle: 'From your clipboard history',
                run: () => this._onPaste(item),
            }));
    }

    _copy(text) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
    }

    _render() {
        this._list.destroy_all_children();
        if (this._results.length === 0) {
            this._list.add_child(new St.Label({
                text: this._entry.text.trim() ? 'Nothing found' : 'Launch apps, calculate (12*(3+4)), convert (5 km to mi), find what you copied',
                style_class: 'osmin-todo-empty',
                x_expand: true,
            }));
            return;
        }
        this._results.forEach((result, index) => {
            const row = new St.Button({style_class: 'osmin-cmd-row', x_expand: true, can_focus: false, reactive: true, track_hover: true});
            if (index === this._selected)
                row.add_style_pseudo_class('checked');
            const box = new St.BoxLayout({x_expand: true});
            const icon = new St.Icon({style_class: 'osmin-cmd-icon', y_align: Clutter.ActorAlign.CENTER});
            if (result.gicon)
                icon.gicon = result.gicon;
            else
                icon.icon_name = result.icon;
            box.add_child(icon);
            const title = new St.Label({text: result.title, style_class: 'osmin-cmd-title', y_align: Clutter.ActorAlign.CENTER});
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_child(title);
            const subtitle = new St.Label({text: result.subtitle ?? '', style_class: 'osmin-cmd-subtitle', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            subtitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_child(subtitle);
            row.set_child(box);
            row.connect('clicked', () => this._run(index));
            this._list.add_child(row);
        });
        // Keep the chosen row in view.
        const row = this._list.get_child_at_index(this._selected);
        if (row && this._scroll.mapped) {
            const adjustment = this._scroll.vadjustment;
            const rowBottom = row.y + row.height;
            if (rowBottom > adjustment.value + adjustment.page_size)
                adjustment.value = rowBottom - adjustment.page_size;
            else if (row.y < adjustment.value)
                adjustment.value = row.y;
        }
    }

    _run(index) {
        const result = this._results[index];
        if (!result)
            return;
        // Stopping a process asks twice.
        if (result.confirm && !result.armed) {
            result.armed = true;
            result.subtitle = 'Press Enter again to stop it now';
            this._selected = index;
            this._render();
            return;
        }
        this._entry.text = '';
        this.stopTyping();
        this._onDone();
        result.run();
    }
}
