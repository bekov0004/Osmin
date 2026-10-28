import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {createButton} from '../../ui/button.js';
import {snap} from '../../windows/layout.js';
import {OsminWidget} from '../widget.js';

const SNAPS = [
    ['left', 'go-previous-symbolic', 'Left half'],
    ['right', 'go-next-symbolic', 'Right half'],
    ['top', 'go-up-symbolic', 'Top half'],
    ['bottom', 'go-down-symbolic', 'Bottom half'],
    ['maximize', 'view-fullscreen-symbolic', 'Maximize'],
    ['center', 'view-restore-symbolic', 'Center'],
    ['nextMonitor', 'video-display-symbolic', 'Next monitor'],
    ['restore', 'edit-undo-symbolic', 'Put it back'],
];
const PREVIEW_W = 104;
const PREVIEW_H = 64;

/**
 * Windows: live previews of every open window (click to bring one forward, ✕ to close it) and
 * buttons that snap the window you were working in to a half of the screen, maximize, centre, send
 * to the next monitor, or put it back where it was.
 */
export class WindowsWidget extends OsminWidget {
    static id = 'windows';
    static title = 'Windows';
    static iconName = 'focus-windows-symbolic';

    constructor(context) {
        super(context);
        this._clones = [];
        this._target = null; // the window the buttons act on: the last one that had the focus
    }

    createView() {
        const root = new St.BoxLayout({
            vertical: true,
            style_class: 'osmin-widget osmin-windows',
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const row = new St.BoxLayout({style_class: 'osmin-tools-row', x_expand: true});
        for (const [action, icon, tip] of SNAPS) {
            const button = createButton({iconName: icon, styleClass: 'osmin-windows-snap', expand: true, onClick: () => this._snap(action)});
            button.accessible_name = tip;
            row.add_child(button);
        }
        root.add_child(row);
        this._scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.EXTERNAL, vscrollbar_policy: St.PolicyType.NEVER, overlay_scrollbars: true, x_expand: true, y_expand: true});
        this._previews = new St.BoxLayout({style_class: 'osmin-windows-row', y_align: Clutter.ActorAlign.CENTER});
        this._scroll.add_child(this._previews);
        this._scroll.connect('scroll-event', (_a, event) => {
            const adjustment = this._scroll.hadjustment;
            switch (event.get_scroll_direction()) {
            case Clutter.ScrollDirection.UP:
                adjustment.value -= 80;
                return Clutter.EVENT_STOP;
            case Clutter.ScrollDirection.DOWN:
                adjustment.value += 80;
                return Clutter.EVENT_STOP;
            default:
                return Clutter.EVENT_PROPAGATE;
            }
        });
        root.add_child(this._scroll);
        this._empty = new St.Label({text: 'No open windows', style_class: 'osmin-todo-empty', x_expand: true, x_align: Clutter.ActorAlign.CENTER});
        root.add_child(this._empty);
        return root;
    }

    onPageShown() {
        // The window that has the focus when the capsule opens is the one the buttons act on.
        const focus = global.display.focus_window;
        if (focus && focus.get_window_type() === Meta.WindowType.NORMAL)
            this._target = focus;
        this._rebuild();
    }

    onPageHidden() {
        this._clear();
    }

    _snap(action) {
        const window = this._target && !this._target.is_destroyed?.() ? this._target : null;
        snap(action, window ?? undefined);
    }

    _clear() {
        this._previews?.destroy_all_children();
        this._clones = [];
    }

    _rebuild() {
        if (!this._view)
            return;
        this._clear();
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL, null);
        this._empty.visible = windows.length === 0;
        for (const window of windows) {
            const actor = window.get_compositor_private();
            if (!actor)
                continue;
            const card = new St.BoxLayout({vertical: true, style_class: 'osmin-win'});
            const thumb = new St.Button({style_class: 'osmin-win-thumb', can_focus: true, width: PREVIEW_W, height: PREVIEW_H, reactive: true, track_hover: true});
            const [width, height] = actor.get_size();
            const clone = new Clutter.Clone({source: actor, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
            const scale = Math.min(PREVIEW_W / Math.max(width, 1), PREVIEW_H / Math.max(height, 1));
            clone.set_size(Math.round(width * scale), Math.round(height * scale));
            thumb.set_child(clone);
            thumb.connect('clicked', () => {
                Main.activateWindow(window);
                this.context.ui?.closeCapsule?.();
            });
            card.add_child(thumb);
            const line = new St.BoxLayout({x_expand: true});
            const title = new St.Label({text: window.get_title() ?? '', style_class: 'osmin-win-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            line.add_child(title);
            const close = createButton({iconName: 'window-close-symbolic', styleClass: 'osmin-ls-file-remove', onClick: () => {
                window.delete(global.get_current_time());
                card.destroy();
            }});
            line.add_child(close);
            card.add_child(line);
            this._previews.add_child(card);
            this._clones.push(clone);
        }
    }

    destroy() {
        this._clear();
        super.destroy();
    }
}
