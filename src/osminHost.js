import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Osmin} from './osmin.js';
import {ActivityManager} from './services/activityManager.js';
import {ArtworkService} from './services/artworkService.js';
import {CalendarService} from './services/calendarService.js';
import {CameraService} from './services/cameraService.js';
import {ClipboardService} from './services/clipboardService.js';
import {EventManager} from './services/eventManager.js';
import {FileService} from './services/fileService.js';
import {MediaService} from './services/mediaService.js';
import {NotesService} from './services/notesService.js';
import {NotificationsService} from './services/notificationsService.js';
import {PanelService} from './services/panelService.js';
import {TimerService} from './services/timerService.js';
import {TodoService} from './services/todoService.js';
import {targetMonitors} from './utils/monitors.js';
import {SignalTracker} from './utils/signals.js';

/**
 * Everything Osmin shares between its capsules: the services (music, timer, files, ...), the event
 * stream and the top bar. A capsule (Osmin) is created for each monitor the user chose in the
 * settings; the services run once, whatever the number of capsules.
 *
 * The first capsule is the "leader": it publishes the widgets' Live Activities. The capsule on
 * the primary monitor also takes the GNOME clock's place in the top bar; when the primary
 * monitor is not among the chosen ones, the top bar is left exactly as GNOME has it.
 */
export class OsminHost {
    /**
     * @param {SettingsService} settings
     * @param {{openPreferences?: Function}} [options]
     */
    constructor(settings, {openPreferences = () => {}} = {}) {
        this._settings = settings;
        this._openPreferences = openPreferences;
        this._signals = new SignalTracker();
        this._capsules = new Map();   // monitor index -> Osmin
        this._panel = null;
        this._events = null;
        this._services = null;
        this._syncing = false;
        this._leaderIndex = -1;
        this._barTaken = false;
    }

    /** The capsules, the leader first. */
    get capsules() {
        return [...this._capsules.values()];
    }

    enable() {
        this._events = new EventManager();
        this._panel = new PanelService({
            onChanged: () => this._capsules.forEach(osmin => osmin._relayout()),
            onToggleRequest: () => this.toggle(),
        });
        this._services = {
            media: new MediaService(),
            artwork: new ArtworkService(),
            files: new FileService({persist: () => this._settings.get('tray-keep-files')}),
            calendar: new CalendarService(),
            activities: new ActivityManager(this._events),
            timer: new TimerService(),
            todo: new TodoService(),
            notes: new NotesService(),
            notifications: new NotificationsService(),
            camera: new CameraService(),
            clipboard: new ClipboardService({
                keepHistory: () => this._settings.get('clipboard-keep-history'),
                maxItems: () => this._settings.get('clipboard-max-items'),
            }),
        };
        this._syncCapsules();
        this._settings.connectObject('changed', (_s, key) => this._onSettingChanged(key), this);
        // Monitor indices may all change when a screen is plugged or unplugged: start over.
        this._signals.connect(Main.layoutManager, 'monitors-changed', () => this._syncCapsules({rebuild: true}));

        const services = this._services;
        services.timer.load();
        services.todo.load();
        services.notes.load();
        services.clipboard.start();
        services.notifications.start();
        services.media.start();
        services.calendar.start().catch(e => console.warn(`[osmin] calendar failed: ${e.message}`));
        services.files.load().catch(e => console.warn(`[osmin] loading the file tray failed: ${e.message}`));
    }

    destroy() {
        this._settings?.disconnectObject(this);
        this._signals.disconnectAll();
        for (const osmin of [...this._capsules.values()].reverse())
            osmin.destroy();
        this._capsules.clear();

        const services = this._services;
        if (services) {
            services.media.destroy();
            services.artwork.destroy();
            services.files.destroy();
            services.calendar.destroy();
            services.activities.destroy();
            services.timer.destroy();
            services.todo.destroy();
            services.notes.destroy();
            services.camera.destroy();
            services.clipboard.destroy();
            services.notifications.destroy();
        }
        this._services = null;
        this._events?.destroy();
        this._events = null;
        // Last: brings the GNOME clock back.
        this._panel?.destroy();
        this._panel = null;
    }

    /** The shortcut (Super+V): the capsule on the monitor the pointer is on, otherwise the first one. */
    toggle() {
        const index = global.display.get_current_monitor();
        (this._capsules.get(index) ?? this._capsules.values().next().value)?.toggle();
    }

    _onSettingChanged(key) {
        if (key === 'monitors')
            this._syncCapsules();
        else if (key === 'panel-color' || key === 'panel-opacity')
            this._applyBarLook();
    }

    /** Capsules for exactly the monitors that are chosen and connected right now. */
    _syncCapsules({rebuild = false} = {}) {
        if (this._syncing || !this._panel)
            return;
        this._syncing = true;
        try {
            const wanted = targetMonitors(this._settings.get('monitors'));
            for (const [index, osmin] of [...this._capsules]) {
                if (rebuild || !wanted.includes(index)) {
                    osmin.destroy();
                    this._capsules.delete(index);
                }
            }
            // The leader is the first of the list: if it changed, start over so the
            // activities are published by the right capsule.
            const leader = this._capsules.values().next().value;
            if (leader && this._leaderIndex !== wanted[0]) {
                for (const osmin of [...this._capsules.values()].reverse())
                    osmin.destroy();
                this._capsules.clear();
            }
            this._leaderIndex = wanted[0];

            this._syncBar(wanted);
            for (const index of wanted) {
                if (this._capsules.has(index))
                    continue;
                const osmin = new Osmin(this._settings, {
                    shared: {events: this._events, services: this._services, panel: this._panel},
                    monitorIndex: () => index,
                    leader: index === wanted[0],
                    openPreferences: this._openPreferences,
                });
                this._capsules.set(index, osmin);
                osmin.enable();
            }
            this._capsules.forEach(osmin => osmin._relayout());
        } finally {
            this._syncing = false;
        }
    }

    /** The GNOME clock is replaced only when the capsule sits on the monitor that has the top bar. */
    _syncBar(wanted) {
        const onBar = wanted.includes(Main.layoutManager.primaryIndex);
        if (onBar && !this._barTaken) {
            this._panel.enable();
            this._barTaken = true;
            this._applyBarLook();
        } else if (!onBar && this._barTaken) {
            this._panel.destroy();
            this._barTaken = false;
        }
    }

    _applyBarLook() {
        if (!this._barTaken)
            return;
        this._panel.setBarLook({
            color: this._settings.get('panel-color'),
            opacity: this._settings.get('panel-opacity'),
        });
    }
}
