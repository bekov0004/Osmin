import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {createButton} from '../../ui/button.js';
import {menuCard, menuChips, menuHeader} from '../../ui/menuKit.js';
import {restoreTiled, snap, tile} from '../../windows/layout.js';
import {OsminWidget} from '../widget.js';

const SNAPS = [
    ['left', 'go-previous-symbolic', 'Left half', 'Left'],
    ['right', 'go-next-symbolic', 'Right half', 'Right'],
    ['top', 'go-up-symbolic', 'Top half', 'Top'],
    ['bottom', 'go-down-symbolic', 'Bottom half', 'Bottom'],
    ['maximize', 'view-fullscreen-symbolic', 'Maximize', 'Full'],
    ['center', 'view-restore-symbolic', 'Centre', 'Centre'],
    ['nextMonitor', 'video-display-symbolic', 'Next monitor', 'Monitor'],
    ['restore', 'edit-undo-symbolic', 'Put it back', 'Undo'],
];
const TILES = [
    ['columns', 'Columns'],
    ['rows', 'Rows'],
    ['grid', 'Grid'],
    ['main', 'Main + side'],
];
const PREVIEW_W = 112;
const PREVIEW_H = 70;

/**
 * Windows: live previews of every open window (click to bring one forward, ✕ to close it) and
 * buttons that snap the window you were working in to a half of the screen, maximize, centre, send
 * to the next monitor, or put it back where it was; and four buttons that tile all the windows of the
 * monitor at once (columns, rows, a grid, one main window with the rest beside it).
 */
export class WindowsWidget extends OsminWidget {
    static id = 'windows';
    static title = 'Windows';
    static iconName = 'focus-windows-symbolic';
    static menuNative = true;

    constructor(context) {
        super(context);
        this._clones = [];
        this._target = null; // the window the buttons act on: the last one that had the focus
        this._selected = new Set(); // windows ticked in the list: the tile buttons arrange only these
    }

    createView() {
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-widget osmin-windows osmin-menu-page', x_expand: true});

        // Arrange every window (or the ticked ones) at once.
        root.add_child(menuHeader('Arrange windows'));
        const arrange = menuCard();
        const tiles = menuChips(TILES.map(([id, label]) => ({id, label})), mode => this._tile(mode), {perRow: 4});
        tiles.actor.add_style_class_name('osmin-card-pad');
        arrange.add_child(tiles.actor);
        this._tileHint = new St.Label({style_class: 'osmin-card-hint'});
        arrange.add_child(this._tileHint);
        root.add_child(arrange);
        this._hint();

        // Move the one window you were working in.
        root.add_child(menuHeader('This window'));
        const snapCard = menuCard();
        const snaps = menuChips(SNAPS.map(([id, icon, tip, label]) => ({id, icon, label})), action => this._snap(action), {perRow: 4});
        snaps.actor.add_style_class_name('osmin-card-pad');
        snapCard.add_child(snaps.actor);
        root.add_child(snapCard);

        root.add_child(menuHeader('Open windows'));
        const listCard = menuCard();
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
        listCard.add_child(this._scroll);
        root.add_child(listCard);
        this._empty = new St.Label({text: 'No open windows', style_class: 'osmin-todo-empty', x_expand: true, x_align: Clutter.ActorAlign.CENTER});
        listCard.add_child(this._empty);
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

    _tile(mode) {
        const window = this._target && !this._target.is_destroyed?.() ? this._target : null;
        tile(mode, window ?? undefined, [...this._selected]);
    }

    _snap(action) {
        if (action === 'restore' && restoreTiled())
            return;
        const window = this._target && !this._target.is_destroyed?.() ? this._target : null;
        snap(action, window ?? undefined);
    }

    _markSelection(thumb, window) {
        if (this._selected.has(window))
            thumb.add_style_pseudo_class('checked');
        else
            thumb.remove_style_pseudo_class('checked');
    }

    _hint() {
        const count = [...this._selected].filter(w => !w.is_destroyed?.()).length;
        if (this._tileHint)
            this._tileHint.text = count > 0 ? `Only the ${count} ticked window${count === 1 ? '' : 's'} below will be arranged` : 'All windows of this screen are arranged. Tick some below to choose.';
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
        this._selected = new Set([...this._selected].filter(w => windows.includes(w)));
        this._hint();
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
            // A click ticks the window: the tile buttons then arrange only the ticked ones.
            thumb.connect('clicked', () => {
                if (this._selected.has(window))
                    this._selected.delete(window);
                else
                    this._selected.add(window);
                this._markSelection(thumb, window);
                this._hint();
            });
            this._markSelection(thumb, window);
            card.add_child(thumb);
            const line = new St.BoxLayout({x_expand: true});
            // The title brings the window forward.
            const title = new St.Button({style_class: 'osmin-win-titlebutton', x_expand: true, x_align: Clutter.ActorAlign.START, reactive: true, track_hover: true});
            const titleLabel = new St.Label({text: window.get_title() ?? '', style_class: 'osmin-win-title', y_align: Clutter.ActorAlign.CENTER});
            titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            title.set_child(titleLabel);
            title.connect('clicked', () => {
                Main.activateWindow(window);
                this.context.ui?.closeCapsule?.();
            });
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
