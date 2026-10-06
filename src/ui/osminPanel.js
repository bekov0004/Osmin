import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {animDuration} from '../utils/animation.js';
import {Layout} from '../utils/constants.js';
import {createButton} from './button.js';

/**
 * The expanded capsule: pages of widget columns (up to Layout.COLUMNS per
 * page), a footer with the page dots and a close button.
 * Its width is set from outside (it adapts to the monitor); the height is
 * fixed by the content area.
 */
export class OsminPanel extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminPanel'}, this);
    }

    /** @param {{widgets: OsminWidget[], onClose: Function}} params */
    constructor({widgets, onClose}) {
        super({
            vertical: true,
            style_class: 'osmin-panel',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });

        this._widgets = widgets;
        this._pages = [];
        this._pageIndex = 0;
        this._width = 0;

        this._pageArea = new St.Widget({
            style_class: 'osmin-pages',
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            x_expand: true,
        });
        this.add_child(this._pageArea);

        this._dots = new St.BoxLayout({
            style_class: 'osmin-dots',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const footer = new St.Widget({
            style_class: 'osmin-footer',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        const closeButton = createButton({
            iconName: 'window-close-symbolic',
            styleClass: 'osmin-close-button',
            onClick: onClose,
        });
        // In a BinLayout a child is only aligned if it also expands.
        for (const [child, align] of [
            [this._dots, Clutter.ActorAlign.CENTER],
            [closeButton, Clutter.ActorAlign.END],
        ]) {
            child.set({x_expand: true, y_expand: true, x_align: align, y_align: Clutter.ActorAlign.CENTER});
            footer.add_child(child);
        }
        this.add_child(footer);

        this._buildPages();
    }

    get pageCount() {
        return this._pages.length;
    }

    get pageIndex() {
        return this._pageIndex;
    }

    /** Sets the panel width (px) and lays the columns out for it. */
    setWidth(width) {
        if (width === this._width)
            return;
        this._width = width;
        this.set_width(width);
        this._layoutColumns();
    }

    /** Height in px the panel needs at the given width. */
    getHeightForWidth(width) {
        return this.get_preferred_height(width)[1];
    }

    /** @param {GLib.DateTime} now */
    tick(now) {
        for (const widget of this._widgets)
            widget.onTick(now);
    }

    /** The capsule finished opening or closing; tells the visible widgets. */
    setOpen(open) {
        const widgets = this._pages[this._pageIndex]?.widgets ?? [];
        for (const widget of widgets) {
            if (open)
                widget.onPageShown();
            else
                widget.onPageHidden();
        }
    }

    nextPage() {
        return this.showPage(this._pageIndex + 1);
    }

    previousPage() {
        return this.showPage(this._pageIndex - 1);
    }

    /** @returns {boolean} whether the page changed */
    showPage(index, {animate = true} = {}) {
        if (index < 0 || index >= this._pages.length || index === this._pageIndex)
            return false;

        const from = this._pages[this._pageIndex];
        const to = this._pages[index];
        const direction = index > this._pageIndex ? 1 : -1;
        this._pageIndex = index;

        from.widgets.forEach(w => w.onPageHidden());
        to.widgets.forEach(w => w.onPageShown());
        this._updateDots();

        const shift = 28 * direction * (animate ? 1 : 0);
        from.actor.remove_all_transitions();
        to.actor.remove_all_transitions();
        from.actor.ease({
            opacity: 0,
            translation_x: -shift,
            duration: animDuration(140),
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => from.actor.hide(),
        });
        to.actor.set({opacity: 0, translation_x: shift});
        to.actor.show();
        to.actor.ease({
            opacity: 255,
            translation_x: 0,
            duration: animDuration(220),
            delay: animDuration(60),
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        return true;
    }

    _buildPages() {
        const perPage = Layout.COLUMNS;
        for (let i = 0; i < this._widgets.length; i += perPage) {
            const widgets = this._widgets.slice(i, i + perPage);
            const actor = new St.BoxLayout({
                style_class: 'osmin-page',
                x_expand: true,
                y_expand: true,
                opacity: 0,
                visible: false,
            });
            widgets.forEach((widget, column) => {
                const holder = new St.Bin({
                    style_class: `osmin-column${column > 0 ? ' osmin-column-separated' : ''}`,
                    y_expand: true,
                    x_align: Clutter.ActorAlign.FILL,
                    y_align: Clutter.ActorAlign.FILL,
                    child: widget.view,
                });
                actor.add_child(holder);
            });
            this._pageArea.add_child(actor);
            this._pages.push({actor, widgets});
        }

        const first = this._pages[0];
        if (first) {
            first.actor.opacity = 255;
            first.actor.show();
        }
        this._updateDots();
    }

    /** Equal column widths on every page. */
    _layoutColumns() {
        for (const {actor} of this._pages) {
            const columns = actor.get_children();
            const share = Math.floor(this._width / columns.length);
            for (const column of columns)
                column.set_width(share);
        }
    }

    _updateDots() {
        this._dots.destroy_all_children();
        this._dots.visible = this._pages.length > 1;
        this._pages.forEach((_page, index) => {
            this._dots.add_child(new St.Widget({
                style_class: `osmin-dot${index === this._pageIndex ? ' osmin-dot-active' : ''}`,
            }));
        });
    }
}
