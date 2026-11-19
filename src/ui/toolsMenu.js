import Clutter from 'gi://Clutter';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {createButton} from './button.js';
import {Logo} from './logo.js';
import {menuCard, menuHeader} from './menuKit.js';

const ROLE = 'osmin-tools';
const MENU_WIDTH = 420;

/**
 * The button in the top bar and the window it opens: a row of icon tabs, and under it the page of
 * the chosen tab. The pages are the utility widgets (Windows, Quick Toggles, Focus, System, Sound,
 * Input, Downloads, AI Agents), so every function has room instead of being squeezed into the capsule.
 */
export class ToolsMenu {
    /**
     * @param {OsminWidget[]} widgets the pages, in order (already created with a context)
     * @param {{openSettings: Function}} options
     */
    constructor(widgets, {openSettings, baseIcon = 'view-app-grid-symbolic'}) {
        this._baseIcon = baseIcon;
        this._lookIcon = null;
        this._widgets = widgets;
        this._openSettings = openSettings;
        this._current = -1;
        this._tabs = [];
        this._pages = [];
        this._button = null;
    }

    get menu() {
        return this._button?.menu ?? null;
    }

    close() {
        this._button?.menu.close();
    }

    /** The icon the button has when nothing special is going on. */
    setBaseIcon(name) {
        this._baseIcon = name;
        this.setLook(this._lookIcon, this._lookColor);
    }

    /** Writes short readings next to the icon ([] removes them): [{label, value}]. */
    setReadings(readings) {
        if (!this._readings)
            return;
        const esc = text => GLib.markup_escape_text(text, -1);
        this._readingsButton.visible = readings.length > 0;
        this._readings.clutter_text.set_markup(readings.map(r => `<span size="x-small" alpha="60%">${esc(r.label)}</span> <b>${esc(r.value)}</b>`).join('   '));
    }

    /** While the computer is kept awake the icon of the button changes (icon null: back to normal). */
    setLook(icon, color) {
        this._lookIcon = icon;
        this._lookColor = color;
        if (!this._icon)
            return;
        this._icon.icon_name = icon ?? this._baseIcon;
        this._icon.style = icon && color ? `color: ${color};` : '';
    }

    enable() {
        this._button = new PanelMenu.Button(0.5, 'Osmin', false);
        this._icon = new St.Icon({icon_name: this._baseIcon, style_class: 'system-status-icon'});
        this._button.add_child(this._icon);
        // The readings (CPU, temperature ...) are a top-bar item of their own, beside the button: pressing the button
        // lights only the button. Pressing the readings opens the System page.
        this._readings = new St.Label({style_class: 'osmin-bar-readings', y_align: Clutter.ActorAlign.CENTER});
        this._readingsButton = new St.Button({
            style_class: 'panel-button osmin-bar-readings-button', reactive: true, can_focus: true, track_hover: true,
            child: this._readings, visible: false, accessible_name: 'System readings',
        });
        this._readingsButton.connect('clicked', () => {
            this.openPage('system');
            this._button.menu.open();
        });
        this._button.menu.actor.add_style_class_name('osmin-menu');

        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, activate: false});
        item.add_style_class_name('osmin-menu-item');
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-menu-root', width: MENU_WIDTH});
        item.add_child(root);
        this._button.menu.addMenuItem(item);

        const logo = new St.BoxLayout({style_class: 'osmin-menu-logo', x_expand: true});
        const mark = new Logo();
        mark.x_expand = true;
        logo.add_child(mark);
        root.add_child(logo);

        // The icon tabs: they keep their size; when there are more than fit, the row scrolls sideways (wheel, touchpad,
        // and the chosen tab is brought into view), its ends fading out.
        const tabsFrame = new St.Bin({style_class: 'osmin-menu-tabs', x_expand: true});
        this._tabsScroll = new St.ScrollView({
            style_class: 'osmin-menu-tabs-scroll',
            hscrollbar_policy: St.PolicyType.EXTERNAL,
            vscrollbar_policy: St.PolicyType.NEVER,
            overlay_scrollbars: true,
            x_expand: true,
        });
        const tabs = new St.BoxLayout({style_class: 'osmin-menu-tabs-row', x_expand: true});
        this._widgets.forEach((widget, index) => {
            const tab = createButton({iconName: widget.constructor.iconName, styleClass: 'osmin-menu-tab', expand: true, onClick: () => this._select(index)});
            tab.accessible_name = widget.constructor.title;
            tabs.add_child(tab);
            this._tabs.push(tab);
        });
        this._tabsScroll.set_child(tabs);
        this._tabsScroll.connect('scroll-event', (_a, event) => this._scrollTabs(event));
        tabsFrame.set_child(this._tabsScroll);
        root.add_child(tabsFrame);

        const titleRow = new St.BoxLayout({x_expand: true, style_class: 'osmin-menu-titlerow'});
        this._title = new St.Label({style_class: 'osmin-menu-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        titleRow.add_child(this._title);
        this._customize = createButton({iconName: 'media-eq-symbolic', styleClass: 'osmin-menu-customize', onClick: () => this._setCustomizing(true)});
        this._customize.accessible_name = 'Customize';
        this._reset = createButton({iconName: 'edit-undo-symbolic', styleClass: 'osmin-menu-reset', onClick: () => this._widgets[this._current]?.resetLayout?.()});
        this._ok = createButton({iconName: 'object-select-symbolic', label: 'OK', styleClass: 'osmin-menu-ok', onClick: () => this._setCustomizing(false)});
        [this._customize, this._reset, this._ok].forEach(b => titleRow.add_child(b));
        this._reset.hide();
        this._ok.hide();
        root.add_child(titleRow);

        // The pages: only the chosen one is shown; a tall one scrolls.
        this._scroll = new St.ScrollView({
            style_class: 'osmin-menu-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
        });
        const pages = new St.BoxLayout({vertical: true, x_expand: true, y_expand: false, y_align: Clutter.ActorAlign.START});
        this._scroll.set_child(pages);
        root.add_child(this._scroll);
        // A widget laid out with the menu kit is a page as it is; any other is put in a card under its title.
        this._pages = this._widgets.map(widget => {
            let page = widget.view;
            if (!widget.constructor.menuNative) {
                page = new St.BoxLayout({vertical: true, style_class: 'osmin-menu-page', x_expand: true});
                page.add_child(menuHeader(widget.constructor.title));
                const card = menuCard();
                card.add_style_class_name('osmin-card-wrap');
                card.add_child(widget.view);
                page.add_child(card);
            }
            page.y_expand = false;
            page.y_align = Clutter.ActorAlign.START;
            page.hide();
            pages.add_child(page);
            return page;
        });

        if (this._widgets.length === 0) {
            root.add_child(new St.Label({
                text: 'No tools are turned on.\nOpen Settings → Features and switch some on.',
                style_class: 'osmin-menu-title',
            }));
        }

        const footer = new St.BoxLayout({style_class: 'osmin-menu-footer', x_expand: true});
        const app = GioUnix.DesktopAppInfo.new('dev.osmin.Osmin.desktop');
        if (app) {
            footer.add_child(createButton({
                iconName: 'view-app-grid-symbolic', label: 'Osmin app', styleClass: 'osmin-menu-action', expand: true,
                onClick: () => {
                    this.close();
                    app.launch([], null);
                },
            }));
        }
        footer.add_child(createButton({
            iconName: 'emblem-system-symbolic', label: 'Settings', styleClass: 'osmin-menu-action', expand: true,
            onClick: () => {
                this.close();
                this._openSettings();
            },
        }));
        root.add_child(footer);

        this._button.menu.connect('open-state-changed', (_menu, open) => this._onOpenChanged(open));
        if (this._widgets.length > 0)
            this._select(0);
        Main.panel.addToStatusArea(ROLE, this._button, 0, 'right');
        this._button.container.get_parent()?.insert_child_above(this._readingsButton, this._button.container);
    }

    /** The wheel (up and down too) and the touchpad move the tab row sideways. */
    _scrollTabs(event) {
        const adjustment = this._tabsScroll.hadjustment;
        if (adjustment.upper - adjustment.page_size <= 0)
            return Clutter.EVENT_PROPAGATE;
        let delta = 0;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            delta = -60;
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            delta = 60;
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            const [dx, dy] = event.get_scroll_delta();
            delta = (Math.abs(dx) > Math.abs(dy) ? dx : dy) * 30;
            break;
        }
        default:
            return Clutter.EVENT_PROPAGATE;
        }
        adjustment.value = Math.max(adjustment.lower, Math.min(adjustment.value + delta, adjustment.upper - adjustment.page_size));
        return Clutter.EVENT_STOP;
    }

    /** The chosen tab in view (half a tab of the next one showing, so it is plain there is more). */
    _showTab(index) {
        const tab = this._tabs[index];
        const adjustment = this._tabsScroll?.hadjustment;
        if (!tab || !adjustment || !tab.get_stage())
            return;
        const box = tab.get_allocation_box();
        const margin = tab.width * 0.6;
        if (box.x1 - margin < adjustment.value)
            adjustment.ease(Math.max(adjustment.lower, box.x1 - margin), {duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        else if (box.x2 + margin > adjustment.value + adjustment.page_size)
            adjustment.ease(Math.min(adjustment.upper - adjustment.page_size, box.x2 + margin - adjustment.page_size), {duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    /** The customize mode of a page: its rows get handles and eyes. */
    _setCustomizing(on) {
        const widget = this._widgets[this._current];
        widget?.setCustomizing?.(on);
        this._customizing = on;
        this._customize.visible = !on && !!widget?.customizable;
        this._reset.visible = this._ok.visible = on;
    }

    /** Shows the page of the widget with this id, when it is one of the tabs. @returns {boolean} */
    openPage(id) {
        const index = this._widgets.findIndex(w => w.constructor.id === id);
        if (index < 0)
            return false;
        this._select(index);
        return true;
    }

    _onOpenChanged(open) {
        if (open) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._showTab(this._current);
                return GLib.SOURCE_REMOVE;
            });
        }
        const widget = this._widgets[this._current];
        if (open)
            widget?.onPageShown();
        else
            widget?.onPageHidden();
    }

    _select(index) {
        if (index === this._current || index < 0 || index >= this._widgets.length)
            return;
        const open = this._button.menu.isOpen;
        if (open)
            this._widgets[this._current]?.onPageHidden();
        if (this._customizing)
            this._setCustomizing(false);
        this._pages[this._current]?.hide();
        this._current = index;
        const widget = this._widgets[index];
        this._pages[index].show();
        this._title.text = widget.constructor.title.toUpperCase();
        this._tabs.forEach((tab, i) => {
            if (i === index)
                tab.add_style_pseudo_class('checked');
            else
                tab.remove_style_pseudo_class('checked');
        });
        this._customize.visible = !!widget.customizable;
        this._scroll.vadjustment.value = 0;
        this._showTab(index);
        if (open)
            widget.onPageShown();
    }

    destroy() {
        if (this._button?.menu.isOpen)
            this._widgets[this._current]?.onPageHidden();
        this._readingsButton?.destroy();
        this._readingsButton = null;
        this._readings = null;
        this._button?.destroy();
        this._button = null;
        this._tabs = [];
        this._pages = [];
        // The pages are destroyed by whoever created them.
    }
}
