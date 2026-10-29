import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';

import {Osmin} from './osmin.js';
import {ActivityManager} from './services/activityManager.js';
import {ArtworkService} from './services/artworkService.js';
import {CalendarService} from './services/calendarService.js';
import {IndicatorActivity} from './ui/indicatorActivity.js';
import {OsminBackend} from './client/moduleClient.js';
import {AgentsService} from './services/agentsService.js';
import {DownloadsService} from './services/downloadsService.js';
import {FocusService} from './services/focusService.js';
import {LyricsService} from './services/lyricsService.js';
import {LocalSendServer} from './services/localSendServer.js';
import {LocalSendService} from './services/localSendService.js';
import {CameraService} from './services/cameraService.js';
import {ClipboardService} from './services/clipboardService.js';
import {EventManager} from './services/eventManager.js';
import {FileService} from './services/fileService.js';
import {MediaService} from './services/mediaService.js';
import {NotesService} from './services/notesService.js';
import {NotificationsService} from './services/notificationsService.js';
import {PanelService} from './services/panelService.js';
import {SystemService} from './services/systemService.js';
import {TimerService} from './services/timerService.js';
import {TodoService} from './services/todoService.js';
import {EventType, Priority} from './utils/events.js';
import {targetMonitors} from './utils/monitors.js';
import {SignalTracker} from './utils/signals.js';

const SHORTCUTS = [
    ['shortcut-osmin', 'osmin'],
    ['shortcut-tray', 'tray'],
    ['shortcut-clipboard', 'clipboard'],
    ['shortcut-alerts', 'notifications'],
    ['shortcut-command', 'command'],
];

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
        this._shortcutKeys = [];
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
        // The service that does the heavy work (LocalSend, ...) in a process of its own.
        this._backend = new OsminBackend();
        this._backend.start();
        this._services = {
            backend: this._backend,
            media: new MediaService(),
            artwork: new ArtworkService(this._backend.artwork),
            files: new FileService(this._backend.files, {persist: () => this._settings.get('tray-keep-files')}),
            calendar: new CalendarService(this._backend.calendar),
            activities: new ActivityManager(this._events),
            timer: new TimerService(this._backend.timer),
            focus: new FocusService(this._backend.focus),
            system: new SystemService(this._backend.system),
            downloads: new DownloadsService(this._backend.downloads),
            agents: new AgentsService(this._backend.agents),
            lyrics: new LyricsService(this._backend.lyrics),
            todo: new TodoService(this._backend.todo),
            notes: new NotesService(this._backend.notes),
            notifications: new NotificationsService(),
            camera: new CameraService(),
            localSend: new LocalSendService(this._backend.localSend),
            clipboard: new ClipboardService(this._backend.clipboard, {
                keepHistory: () => this._settings.get('clipboard-keep-history'),
                cleanUrls: () => this._settings.get('clipboard-clean-urls'),
                maxItems: () => this._settings.get('clipboard-max-items'),
            }),
        };
        this._syncCapsules();
        this._settings.connectObject('changed', (_s, key) => this._onSettingChanged(key), this);
        // Monitor indices may all change when a screen is plugged or unplugged: start over.
        this._addShortcuts();
        this._syncSuperV();
        this._syncReceiving();
        this._watchInputSource();
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
        this._removeShortcuts();
        this._restoreMessageTrayBinding();
        this._server?.destroy();
        this._server = null;
        this._backend?.localSend.disconnectObject(this);
        this._inputSources?.disconnectObject(this);
        this._inputSources = null;
        this._keymap?.disconnectObject(this);
        this._keymap = null;
        this._services?.activities.end('indicator');
        this._indicator?.destroy();
        this._indicator = null;
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
            services.focus.destroy();
            services.system.destroy();
            services.downloads.destroy();
            services.agents.destroy();
            services.lyrics.destroy();
            services.todo.destroy();
            services.notes.destroy();
            services.camera.destroy();
            services.localSend.destroy();
            this._backend.shutdown();
            this._backend = null;
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
        this._capsuleAtPointer()?.toggle();
    }

    /** The keys that open the panel on a section; they are set in the preferences. */
    _addShortcuts() {
        const gsettings = this._settings.gsettings;
        if (!gsettings)
            return;
        for (const [key, section] of SHORTCUTS) {
            Main.wm.addKeybinding(key, gsettings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this.openSection(section));
            this._shortcutKeys.push(key);
        }
    }

    /**
     * GNOME opens its notification list on Super+V, so that combination cannot be used for a Osmin
     * shortcut. With "free-super-v" on, that default binding is taken away (and given back on disable).
     */
    _syncSuperV() {
        const wanted = this._settings.get('free-super-v');
        const gsettings = this._settings.gsettings;
        if (!gsettings)
            return;
        const shell = new Gio.Settings({schema_id: 'org.gnome.shell.keybindings'});
        const saved = gsettings.get_strv('saved-message-tray-binding');
        if (!wanted) {
            this._restoreMessageTrayBinding();
            return;
        }
        // Left over from a shell that stopped without disabling Osmin: the saved list is the original.
        const original = saved.length > 0 ? saved : shell.get_strv('toggle-message-tray');
        gsettings.set_strv('saved-message-tray-binding', original);
        shell.set_strv('toggle-message-tray', original.filter(binding => binding.toLowerCase() !== '<super>v'));
    }

    /**
     * Short indicators in the capsule itself: the keyboard layout when it is switched and Caps Lock
     * when it is turned on or off. The capsule widens to both sides, shows them for a moment and
     * shrinks back; a new one replaces the one that is showing.
     */
    _watchInputSource() {
        this._indicator = new IndicatorActivity(this._services.activities);
        const startedAt = GLib.get_monotonic_time();
        const quiet = () => GLib.get_monotonic_time() - startedAt < 3 * 1000000; // not at start-up
        try {
            this._inputSources = Keyboard.getInputSourceManager();
            this._inputSources.connectObject('current-source-changed', () => {
                const source = this._inputSources.currentSource;
                if (quiet() || !source || !this._settings.get('show-input-source'))
                    return;
                this._indicator.show({
                    icon: 'input-keyboard-symbolic',
                    text: (source.shortName || source.displayName || 'Keyboard').toUpperCase(),
                });
            }, this);
        } catch (e) {
            this._inputSources = null;
        }
        try {
            this._keymap = global.stage.context.get_backend().get_default_seat().get_keymap();
            this._capsLock = this._keymap.get_caps_lock_state();
            this._keymap.connectObject('state-changed', () => {
                const on = this._keymap.get_caps_lock_state();
                if (on === this._capsLock)
                    return;
                this._capsLock = on;
                if (!quiet() && this._settings.get('show-caps-lock'))
                    this._indicator.show({icon: 'input-keyboard-symbolic', text: on ? 'CAPS ON' : 'CAPS OFF'});
            }, this);
        } catch (e) {
            this._keymap = null;
        }
    }

    /** Starts or stops receiving files with LocalSend, as the setting says. */
    async _syncReceiving() {
        if (!this._settings.get('localsend-receive')) {
            this._server?.stop();
            return;
        }
        if (!this._server) {
            this._server = new LocalSendServer(this._backend.localSend);
            // The service starts afresh when it was restarted: ask it to receive again.
            this._backend.localSend.connectObject('connected', () => {
                if (this._settings.get('localsend-receive'))
                    this._syncReceiving();
            }, this);
            this._server.connectObject('incoming', (_s, transfer) =>
                this._capsuleAtPointer()?.showIncoming(transfer), this);
        }
        const problem = await this._server.start();
        if (problem) {
            console.warn(`[osmin] LocalSend: not receiving: ${problem}`);
            this._events.emit({
                type: EventType.CUSTOM, icon: 'dialog-warning-symbolic',
                title: 'LocalSend is not receiving', description: problem, duration: 6000,
            });
        }
    }

    _restoreMessageTrayBinding() {
        const gsettings = this._settings?.gsettings;
        const saved = gsettings?.get_strv('saved-message-tray-binding') ?? [];
        if (saved.length === 0)
            return;
        new Gio.Settings({schema_id: 'org.gnome.shell.keybindings'}).set_strv('toggle-message-tray', saved);
        gsettings.set_strv('saved-message-tray-binding', []);
    }

    _removeShortcuts() {
        for (const key of this._shortcutKeys)
            Main.wm.removeKeybinding(key);
        this._shortcutKeys = [];
    }

    /** The capsule on the monitor the pointer is on (otherwise the first one). */
    _capsuleAtPointer() {
        return this._capsules.get(global.display.get_current_monitor()) ?? this._capsules.values().next().value;
    }

    openSection(section) {
        this._capsuleAtPointer()?.openSection(section);
    }

    _onSettingChanged(key) {
        if (key === 'monitors')
            this._syncCapsules();
        else if (key === 'free-super-v')
            this._syncSuperV();
        else if (key === 'localsend-receive')
            this._syncReceiving();
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
