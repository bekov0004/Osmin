import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../ui/button.js';

function ago(unix) {
    if (!unix)
        return '';
    const seconds = Math.max(0, GLib.DateTime.new_now_local().to_unix() - unix);
    if (seconds < 60)
        return 'now';
    if (seconds < 3600)
        return `${Math.round(seconds / 60)} min`;
    if (seconds < 86400)
        return `${Math.round(seconds / 3600)} h`;
    return `${Math.round(seconds / 86400)} d`;
}

/** One notification: icon, app, title, text; click opens the app, ✕ dismisses. */
class NotificationRow extends St.Widget {
    static {
        GObject.registerClass({GTypeName: 'OsminNotificationRow'}, this);
    }

    constructor({item, onActivate, onDismiss}) {
        super({
            style_class: 'osmin-notif',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        const main = new St.Button({style_class: 'osmin-notif-main', x_expand: true, can_focus: true});
        const row = new St.BoxLayout({x_expand: true, style_class: 'osmin-notif-row'});
        const icon = new St.Icon({style_class: 'osmin-notif-icon', y_align: Clutter.ActorAlign.CENTER});
        if (item.gicon)
            icon.gicon = item.gicon;
        else
            icon.icon_name = 'dialog-information-symbolic';
        row.add_child(icon);
        const text = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const head = new St.Label({
            text: [item.app, ago(item.time)].filter(Boolean).join(' · '),
            style_class: 'osmin-notif-app',
        });
        text.add_child(head);
        const title = new St.Label({text: item.title, style_class: 'osmin-notif-title'});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(title);
        if (item.body) {
            const body = new St.Label({text: item.body.replace(/\s+/g, ' '), style_class: 'osmin-notif-body'});
            body.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(body);
        }
        row.add_child(text);
        main.set_child(row);
        main.connect('clicked', () => onActivate(item));
        this.add_child(main);

        this._close = createButton({
            iconName: 'window-close-symbolic',
            styleClass: 'osmin-todo-remove',
            onClick: () => onDismiss(item),
        });
        this._close.set({x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER, opacity: 0});
        this.add_child(this._close);
        this.connect('notify::hover', () => this._close.ease({
            opacity: this.hover ? 255 : 0,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        }));
    }
}

/** The Notifications tab: what the shell holds, newest first, with Do Not Disturb. */
export class NotificationsView extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminNotificationsView'}, this);
    }

    /** @param {{service: NotificationsService, onActivate?: Function}} params */
    constructor({service, onActivate}) {
        super({vertical: true, style_class: 'osmin-tray osmin-notifications', x_expand: true, y_expand: true});
        this._service = service;
        this._onActivate = onActivate;

        const header = new St.BoxLayout({style_class: 'osmin-tray-header'});
        this._caption = new St.Label({style_class: 'osmin-tray-caption', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        header.add_child(this._caption);
        this._dnd = new St.Button({style_class: 'osmin-tray-clear osmin-dnd', can_focus: true});
        this._dnd.connect('clicked', () => {
            this._service.dnd = !this._service.dnd;
        });
        header.add_child(this._dnd);
        this._clear = new St.Button({label: 'Clear all', style_class: 'osmin-tray-clear', can_focus: true});
        this._clear.connect('clicked', () => this._service.clear());
        header.add_child(this._clear);
        this.add_child(header);

        this._empty = new St.Label({
            text: 'No notifications',
            style_class: 'osmin-todo-empty',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._empty);

        this._scroll = new St.ScrollView({
            style_class: 'osmin-tray-scroll',
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        this._list = new St.BoxLayout({vertical: true, style_class: 'osmin-notif-list', x_expand: true});
        this._scroll.add_child(this._list);
        this.add_child(this._scroll);

        this._service.connectObject('changed', () => this._rebuild(), this);
        this._rebuild();
    }

    destroy() {
        this._service.disconnectObject(this);
        super.destroy();
    }

    /** Called when the tab is shown, so the times are fresh. */
    refresh() {
        this._rebuild();
    }

    _rebuild() {
        const items = this._service.items;
        this._caption.text = items.length === 0 ? 'NOTIFICATIONS' : `NOTIFICATIONS · ${items.length}`;
        this._dnd.label = this._service.dnd ? 'Do Not Disturb: on' : 'Do Not Disturb: off';
        if (this._service.dnd)
            this._dnd.add_style_pseudo_class('checked');
        else
            this._dnd.remove_style_pseudo_class('checked');
        this._clear.visible = items.length > 0;
        this._empty.visible = items.length === 0;
        this._scroll.visible = items.length > 0;
        this._list.destroy_all_children();
        for (const item of items) {
            this._list.add_child(new NotificationRow({
                item,
                onActivate: i => {
                    this._service.activate(i);
                    this._onActivate?.(i);
                },
                onDismiss: i => this._service.dismiss(i),
            }));
        }
    }
}
