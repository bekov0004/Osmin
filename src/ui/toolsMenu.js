import GioUnix from 'gi://GioUnix';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {createButton} from './button.js';
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
    constructor(widgets, {openSettings}) {
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

    enable() {
        this._button = new PanelMenu.Button(0.5, 'Osmin', false);
        this._button.add_child(new St.Icon({icon_name: 'view-app-grid-symbolic', style_class: 'system-status-icon'}));
        this._button.menu.actor.add_style_class_name('osmin-menu');

        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false, activate: false});
        item.add_style_class_name('osmin-menu-item');
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-menu-root', width: MENU_WIDTH});
        item.add_child(root);
        this._button.menu.addMenuItem(item);

        // The icon tabs.
        const tabs = new St.BoxLayout({style_class: 'osmin-menu-tabs', x_expand: true});
        this._widgets.forEach((widget, index) => {
            const tab = createButton({iconName: widget.constructor.iconName, styleClass: 'osmin-menu-tab', expand: true, onClick: () => this._select(index)});
            tab.accessible_name = widget.constructor.title;
            tabs.add_child(tab);
            this._tabs.push(tab);
        });
        root.add_child(tabs);

        this._title = new St.Label({style_class: 'osmin-menu-title', visible: false});
        root.add_child(this._title);

        // The pages: only the chosen one is shown; a tall one scrolls.
        this._scroll = new St.ScrollView({
            style_class: 'osmin-menu-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
        });
        const pages = new St.BoxLayout({vertical: true, x_expand: true});
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
    }

    _onOpenChanged(open) {
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
        this._pages[this._current]?.hide();
        this._current = index;
        const widget = this._widgets[index];
        this._pages[index].show();
        this._title.text = widget.constructor.title;
        this._tabs.forEach((tab, i) => {
            if (i === index)
                tab.add_style_pseudo_class('checked');
            else
                tab.remove_style_pseudo_class('checked');
        });
        this._scroll.vadjustment.value = 0;
        if (open)
            widget.onPageShown();
    }

    destroy() {
        if (this._button?.menu.isOpen)
            this._widgets[this._current]?.onPageHidden();
        this._button?.destroy();
        this._button = null;
        this._tabs = [];
        this._pages = [];
        // The pages are destroyed by whoever created them.
    }
}
