import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {iconRow, menuDivider} from './menuKit.js';

/**
 * The rows of a page that the user can rearrange: in customize mode every row gets a handle to
 * drag it up or down and an eye to hide it; hidden rows show again only in customize mode.
 * Order and hidden rows are kept in the settings as "page:row".
 */
export class RowList {
    /**
     * @param {{page: string, settings: SettingsService, card: St.BoxLayout, items: object[]}} options
     *   items: {id, icon, title, subtitle?, desc?, control?, chevron?, onClick?}
     */
    constructor({page, settings, card, items}) {
        this._page = page;
        this._settings = settings;
        this._card = card;
        this._items = items;
        this._customizing = false;
        this._rows = new Map();
        this.render();
    }

    get items() {
        return this._items;
    }

    _key(item) {
        return `${this._page}:${item.id}`;
    }

    get _hidden() {
        return new Set(this._settings?.get('menu-hidden') ?? []);
    }

    _ordered() {
        const order = this._settings?.get('menu-order') ?? [];
        const rank = item => {
            const at = order.indexOf(this._key(item));
            return at < 0 ? 10000 + this._items.indexOf(item) : at;
        };
        return [...this._items].sort((a, b) => rank(a) - rank(b));
    }

    setCustomizing(on) {
        this._customizing = on;
        this.render();
    }

    reset() {
        const prefix = `${this._page}:`;
        const gs = this._settings?.gsettings;
        gs?.set_strv('menu-hidden', (this._settings.get('menu-hidden') ?? []).filter(k => !k.startsWith(prefix)));
        gs?.set_strv('menu-order', (this._settings.get('menu-order') ?? []).filter(k => !k.startsWith(prefix)));
        this.render();
    }

    render() {
        this._card.destroy_all_children();
        this._rows.clear();
        const hidden = this._hidden;
        let first = true;
        for (const item of this._ordered()) {
            const isHidden = hidden.has(this._key(item));
            if (isHidden && !this._customizing)
                continue;
            if (!first)
                this._card.add_child(menuDivider());
            first = false;
            const entry = this._build(item, isHidden);
            this._card.add_child(entry);
            this._rows.set(item.id, entry);
        }
    }

    _build(item, isHidden) {
        const subtitle = this._customizing ? (item.desc ?? item.subtitle ?? '') : (item.subtitle ?? '');
        if (!this._customizing) {
            const {row} = iconRow({icon: item.icon, title: item.title, subtitle, control: item.control?.() ?? null, chevron: item.chevron ?? (!item.control && !!item.onClick), onClick: item.onClick, extra: item.extra?.() ?? null});
            return row;
        }
        const line = new St.BoxLayout({x_expand: true, style_class: 'osmin-custom-line'});
        const handle = new St.Button({style_class: 'osmin-custom-handle', reactive: true, track_hover: true,
            child: new St.Icon({icon_name: 'open-menu-symbolic', icon_size: 14})});
        line.add_child(handle);
        const {row} = iconRow({icon: item.icon, title: item.title, subtitle});
        row.x_expand = true;
        row.reactive = false;
        line.add_child(row);
        const eye = new St.Button({style_class: 'osmin-custom-eye', reactive: true, track_hover: true, y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({icon_name: isHidden ? 'view-conceal-symbolic' : 'view-reveal-symbolic', icon_size: 16})});
        eye.connect('clicked', () => this._toggleHidden(item));
        line.add_child(eye);
        if (isHidden)
            line.opacity = 120;
        this._dragHandle(handle, line, item);
        return line;
    }

    _toggleHidden(item) {
        const hidden = this._hidden;
        const key = this._key(item);
        if (hidden.has(key))
            hidden.delete(key);
        else
            hidden.add(key);
        this._settings?.gsettings?.set_strv('menu-hidden', [...hidden]);
        this.render();
    }

    /** Dragging the handle moves the row past the neighbours the pointer reaches. */
    _dragHandle(handle, line, item) {
        handle.connect('button-press-event', (_a, event) => {
            const stage = global.stage;
            line.opacity = 200;
            const id = stage.connect('captured-event', (_s, e) => {
                const type = e.type();
                if (type === Clutter.EventType.MOTION) {
                    const [, y] = e.get_coords();
                    this._moveTo(item, y);
                    return Clutter.EVENT_STOP;
                }
                if (type === Clutter.EventType.BUTTON_RELEASE) {
                    stage.disconnect(id);
                    line.opacity = 255;
                    this._saveOrder();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            void event;
            return Clutter.EVENT_STOP;
        });
    }

    _moveTo(item, pointerY) {
        const children = this._card.get_children().filter(c => !(c instanceof St.Widget && c.has_style_class_name('osmin-card-divider')));
        const entry = this._rows.get(item.id);
        let target = children.length - 1;
        for (let i = 0; i < children.length; i++) {
            const [, top] = children[i].get_transformed_position();
            if (pointerY < top + children[i].height / 2) {
                target = i;
                break;
            }
        }
        const from = children.indexOf(entry);
        if (target === from || target < 0)
            return;
        // Rows and dividers alternate: the row at slot n sits at child index 2n.
        this._card.set_child_at_index(entry, target * 2);
        this._rebuildDividers();
    }

    _rebuildDividers() {
        const rows = this._card.get_children().filter(c => !c.has_style_class_name('osmin-card-divider'));
        this._card.get_children().filter(c => c.has_style_class_name('osmin-card-divider')).forEach(c => c.destroy());
        rows.forEach((row, i) => {
            if (i > 0)
                this._card.insert_child_below(menuDivider(), row);
        });
    }

    _saveOrder() {
        const rows = this._card.get_children().filter(c => !c.has_style_class_name('osmin-card-divider'));
        const idsInOrder = rows.map(row => [...this._rows].find(([, r]) => r === row)?.[0]).filter(Boolean);
        const prefix = `${this._page}:`;
        const others = (this._settings.get('menu-order') ?? []).filter(k => !k.startsWith(prefix));
        this._settings?.gsettings?.set_strv('menu-order', [...others, ...idsInOrder.map(id => `${prefix}${id}`)]);
    }
}
