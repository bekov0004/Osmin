import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {DEFAULT_WIDGETS, WIDGET_INFO} from './src/utils/widgetInfo.js';
import {utilityMethods} from './prefsUtilities.js';

// --- theme -----------------------------------------------------------------
// One place for every colour of the settings window (layered surfaces, a quiet blue accent, a dark
// "capsule" preview). Both schemes follow the system setting.
const SETTINGS_THEME = {
    light: {
        BACKGROUND: '#f2f2f4',
        TOOLBAR: '#e4e4e9',
        SURFACE: '#ffffff',
        CARD: '#f7f7f9',
        CONTROL: 'rgba(0, 0, 0, 0.07)',
        BORDER: 'rgba(0, 0, 0, 0.09)',
        HOVER: 'rgba(0, 0, 0, 0.05)',
        SELECTED: 'rgba(0, 0, 0, 0.09)',
        TEXT: 'rgba(0, 0, 0, 0.86)',
        TEXT_SECONDARY: 'rgba(0, 0, 0, 0.5)',
        TEXT_DISABLED: 'rgba(0, 0, 0, 0.26)',
        ACCENT: '#007aff',
        ACCENT_SOFT: 'rgba(0, 122, 255, 0.14)',
        CAPSULE: '#0c0c10',
        CAPSULE_BLOCK: '#232327',
        TRACK: 'rgba(0, 0, 0, 0.16)',
    },
    dark: {
        BACKGROUND: '#212122',
        TOOLBAR: '#2c2c2f',
        SURFACE: '#2c2c2c',
        CARD: '#363638',
        CONTROL: '#3c3c3d',
        BORDER: 'rgba(255, 255, 255, 0.08)',
        HOVER: 'rgba(255, 255, 255, 0.07)',
        SELECTED: 'rgba(255, 255, 255, 0.12)',
        TEXT: '#f5f5f7',
        TEXT_SECONDARY: '#98989d',
        TEXT_DISABLED: 'rgba(255, 255, 255, 0.28)',
        ACCENT: '#1283ff',
        ACCENT_SOFT: 'rgba(18, 131, 255, 0.2)',
        CAPSULE: '#050507',
        CAPSULE_BLOCK: '#1d1d21',
        TRACK: '#454545',
    },
};

const buildCss = p => `
window.background, window.background > contents { background-color: ${p.BACKGROUND}; }
headerbar { background-image: none; background-color: ${p.BACKGROUND}; box-shadow: none;
    border-bottom: none; color: ${p.TEXT}; }
headerbar label { color: ${p.TEXT}; font-weight: 600; }
preferencespage > scrolledwindow > viewport > clamp, preferencespage clamp { margin: 0; }
preferencespage { background-color: ${p.BACKGROUND}; }
.osmin-prefs { background-color: ${p.BACKGROUND}; color: ${p.TEXT}; }
.osmin-prefs label { color: ${p.TEXT}; }
.osmin-prefs .dim, .osmin-prefs label.dim { color: ${p.TEXT_SECONDARY}; font-size: 12px; }
.osmin-prefs separator { background-color: ${p.BORDER}; min-height: 1px; min-width: 1px; }

.osmin-sidebar { background-color: ${p.TOOLBAR}; border-radius: 14px; margin: 8px 0 8px 8px; padding: 8px 8px 10px 8px; }
.osmin-sidebar searchentry, .osmin-sidebar entry { background-color: ${p.CONTROL}; color: ${p.TEXT}; border: none;
    border-radius: 999px; box-shadow: none; min-height: 28px; padding: 0 8px; margin: 2px 2px 8px 2px; }
.osmin-sidebar searchentry:focus-within { box-shadow: 0 0 0 3px ${p.ACCENT_SOFT}; }
.osmin-sidebar list { background: none; }
.osmin-sidebar row { background: none; border-radius: 10px; padding: 5px 8px; margin: 1px 2px; min-height: 22px; color: ${p.TEXT}; }
.osmin-sidebar row:hover { background-color: ${p.HOVER}; }
.osmin-sidebar row image { color: ${p.ACCENT}; }
.osmin-sidebar row:selected { background-color: ${p.ACCENT}; color: white; }
.osmin-sidebar row:selected image, .osmin-sidebar row:selected label { color: white; }
.osmin-sidebar .caption-heading { color: ${p.TEXT_SECONDARY}; font-size: 11px; font-weight: 600; margin: 10px 8px 3px 6px; }

.osmin-page { padding: 6px 26px 30px 26px; }
.osmin-page-head { margin-bottom: 2px; }
.osmin-page-title { font-size: 17px; font-weight: 700; }
.osmin-head { padding: 10px 14px 6px 14px; }
.osmin-nav { background-color: ${p.TOOLBAR}; border-radius: 999px; padding: 2px 6px; }
.osmin-nav button { min-width: 28px; min-height: 28px; padding: 0 6px; }
.osmin-head-title { font-size: 17px; font-weight: 500; }
.osmin-try { background-color: ${p.ACCENT}; color: white; border-radius: 999px; padding: 6px 16px; border: none; box-shadow: none; font-weight: 600; }
.osmin-try:hover { background-color: ${p.ACCENT}; opacity: 0.9; }
.osmin-pill { background-color: ${p.CONTROL}; color: ${p.TEXT}; border: none; box-shadow: none; border-radius: 999px; padding: 4px 14px; font-weight: 400; }
.osmin-pill label { font-weight: 400; }
.osmin-pill:hover { background-color: ${p.HOVER}; }
.osmin-caps { background-color: ${p.CONTROL}; border: none; box-shadow: none; border-radius: 8px; padding: 3px 6px; }
.osmin-cap { background-color: ${p.HOVER}; border-radius: 5px; padding: 1px 6px; font-size: 12px; }
.osmin-tag { background-color: ${p.CONTROL}; border-radius: 999px; padding: 2px 9px; font-size: 12px; }
.osmin-wheel { background-color: #14161a; color: white; border-radius: 165px; }
.osmin-hub { background-color: rgba(255,255,255,0.12); border-radius: 32px; padding: 18px; color: white; }
.osmin-wheel-btn { background-color: rgba(255,255,255,0.14); border-radius: 22px; min-width: 44px; min-height: 44px; padding: 0; border: none; box-shadow: none; color: white; }
.osmin-drop { min-width: 120px; }
.mb-title { font-size: 15px; font-weight: 700; margin-top: 16px; }
.s-card { background-color: ${p.SURFACE}; border-radius: 12px; padding: 4px 16px; margin-bottom: 6px; }
.s-card-title { font-size: 13px; font-weight: 600; margin: 12px 0 2px 0; }
.s-row { padding: 9px 0; min-height: 26px; }
.s-row-title { font-size: 14.5px; }
.s-card separator { background-color: ${p.BORDER}; min-height: 1px; margin: 0; }
.s-badge { font-size: 10px; font-weight: 600; padding: 1px 8px; border-radius: 8px; background-color: ${p.ACCENT_SOFT}; color: ${p.ACCENT}; }
.s-cost { font-size: 11px; margin-right: 6px; }
.s-badge.island { background-color: rgba(191, 90, 242, 0.16); color: #bf5af2; }
.s-preset { background-color: ${p.SURFACE}; border-radius: 14px; padding: 12px 14px; }
.s-tile { border-radius: 7px; min-width: 26px; min-height: 26px; background-color: ${p.ACCENT_SOFT}; color: ${p.ACCENT}; }
.s-tile image { color: ${p.ACCENT}; }
.s-tile.green { background-color: rgba(48, 209, 88, 0.16); } .s-tile.green image { color: #30d158; }
.s-tile.orange { background-color: rgba(255, 159, 10, 0.16); } .s-tile.orange image { color: #ff9f0a; }
.s-tile.red { background-color: rgba(255, 69, 58, 0.16); } .s-tile.red image { color: #ff453a; }
.s-tile.purple { background-color: rgba(191, 90, 242, 0.16); } .s-tile.purple image { color: #bf5af2; }
.osmin-nav-title { font-size: 15px; font-weight: 600; }
.osmin-toolbar { background-color: ${p.TOOLBAR}; border-bottom: 1px solid ${p.BORDER};
    padding: 8px 10px 8px 10px; }
.osmin-tab { background: none; box-shadow: none; border: none; border-radius: 9px;
    padding: 6px 6px 5px 6px; min-width: 56px; color: ${p.TEXT_SECONDARY};
    transition: background-color 120ms ease, color 120ms ease; }
.osmin-tab:hover { background-color: ${p.HOVER}; }
.osmin-tab:checked { background-color: ${p.SELECTED}; color: ${p.ACCENT}; }
.osmin-tab label, .osmin-tab image { color: inherit; }
.osmin-tab label { font-size: 12px; font-weight: 500; }

.osmin-seg { background-color: ${p.HOVER}; border-radius: 9px; padding: 2px; }
.osmin-seg button { background: none; box-shadow: none; border: none; border-radius: 7px;
    min-height: 24px; padding: 2px 14px; color: ${p.TEXT};
    transition: background-color 120ms ease; }
.osmin-seg button:hover { background-color: ${p.HOVER}; }
.osmin-seg button:checked { background-color: ${p.CONTROL}; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25); }

.osmin-panel { background-color: ${p.SURFACE}; border: 1px solid ${p.BORDER}; border-radius: 14px;
    padding: 14px; }
.osmin-page-title { font-size: 17px; font-weight: 700; }

.osmin-capsule { background-color: ${p.CAPSULE}; border-radius: 0 0 30px 30px; padding: 10px 12px 12px 12px;
    min-height: 74px; }
.osmin-capsule-block { background-color: ${p.CAPSULE_BLOCK}; border-radius: 12px; min-height: 56px; padding: 6px; }
.osmin-capsule-block label { color: white; font-weight: 700; font-size: 12px; }
.osmin-capsule-block image { color: white; }
.osmin-capsule-empty { color: rgba(255, 255, 255, 0.5); }

.osmin-strip { background-color: ${p.HOVER}; border-radius: 16px; padding: 6px; }
.osmin-chip { border-radius: 12px; padding: 7px 8px; transition: background-color 120ms ease; }
.osmin-chip:hover { background-color: ${p.HOVER}; }
.osmin-chip.selected { background-color: ${p.ACCENT_SOFT}; }
.osmin-chip.off .osmin-chip-title, .osmin-chip.off .osmin-chip-sub { color: ${p.TEXT_DISABLED}; }
.osmin-chip-title { font-weight: 700; font-size: 13px; }
.osmin-chip-sub { color: ${p.TEXT_SECONDARY}; font-size: 12px; }
.osmin-icon { background-image: linear-gradient(to bottom, #3d9bff, #1664e8); border-radius: 9px;
    color: white; min-width: 34px; min-height: 34px; }
.osmin-icon image { color: white; }
.osmin-chip.off .osmin-icon { opacity: 0.5; }

.osmin-prefs switch { min-height: 22px; background-color: ${p.TRACK}; border: none; border-radius: 12px;
    transition: background-color 150ms ease; }
.osmin-prefs switch:checked { background-color: ${p.ACCENT}; }
.osmin-prefs switch slider { background-color: white; border: none; border-radius: 10px; min-width: 18px;
    min-height: 18px; margin: 2px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35); }
.osmin-prefs checkbutton { color: ${p.TEXT}; }
.osmin-prefs checkbutton radio { background-color: ${p.CONTROL}; border: 1px solid ${p.BORDER}; min-width: 16px; min-height: 16px; }
.osmin-prefs checkbutton radio:checked { background-color: ${p.ACCENT}; border-color: ${p.ACCENT}; color: white; }
.osmin-prefs scale trough { background-color: ${p.TRACK}; min-height: 4px; border-radius: 2px; border: none; }
.osmin-prefs scale highlight { background-color: ${p.ACCENT}; border-radius: 2px; border: none; }
.osmin-prefs scale slider { background-color: white; border: none; min-width: 16px; min-height: 16px;
    border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4); }
.osmin-prefs scale slider:hover { box-shadow: 0 1px 4px rgba(0, 0, 0, 0.55); }
.osmin-value { background-color: ${p.CONTROL}; color: ${p.TEXT}; border: 1px solid ${p.BORDER};
    border-radius: 7px; min-height: 26px; box-shadow: none; }
.osmin-value text { color: ${p.TEXT}; }
.osmin-value button { background: none; box-shadow: none; border: none; color: ${p.TEXT_SECONDARY}; }
.osmin-btn { background-color: ${p.CONTROL}; color: ${p.TEXT}; border: 1px solid ${p.BORDER};
    border-radius: 8px; box-shadow: none; padding: 3px 14px; min-height: 26px;
    transition: background-color 120ms ease; }
.osmin-btn:hover { background-color: ${p.CARD}; }
.osmin-btn:active { background-color: ${p.SELECTED}; }
.osmin-btn:disabled { color: ${p.TEXT_DISABLED}; }
.osmin-btn.destructive { color: #e5484d; }
.osmin-prefs dropdown > button { background-color: ${p.CONTROL}; color: ${p.TEXT}; border: 1px solid ${p.BORDER};
    border-radius: 8px; box-shadow: none; min-height: 26px; }

.mb-card { background-color: ${p.CARD}; border-radius: 22px; padding: 18px 20px; }
.mb-title { font-weight: 700; font-size: 16px; }
.mb-row { padding: 8px 6px; border-radius: 12px; }
.mb-row.drop { background-color: ${p.ACCENT_SOFT}; }
.mb-row.off .mb-name, .mb-row.off .mb-desc { color: ${p.TEXT_DISABLED}; }
.mb-row.off .mb-square { opacity: 0.45; }
.mb-name { font-weight: 600; font-size: 13px; }
.mb-desc { color: ${p.TEXT_SECONDARY}; font-size: 12px; }
.mb-handle { color: ${p.TEXT_SECONDARY}; padding: 0 8px 0 2px; }
.mb-square { background-color: ${p.ACCENT_SOFT}; border-radius: 10px; min-width: 38px; min-height: 38px; color: ${p.ACCENT}; }
.mb-square image { color: ${p.ACCENT}; }
.mb-prev-bar { background-color: ${p.CAPSULE}; border-radius: 8px; padding: 6px 8px; min-height: 22px; }
.mb-prev-bar image { color: rgba(255, 255, 255, 0.85); }
.mb-prev-icon { background-color: rgba(255, 255, 255, 0.9); border-radius: 6px; padding: 2px 6px; }
.mb-prev-icon image { color: #111; }
.mb-prev-win { background-color: ${p.CAPSULE_BLOCK}; border-radius: 14px; padding: 10px; border: 1px solid rgba(255, 255, 255, 0.08); }
.mb-prev-tab { padding: 3px; border-radius: 6px; }
.mb-prev-tab image { color: rgba(255, 255, 255, 0.6); }
.mb-prev-tab.on { background-color: rgba(10, 132, 255, 0.3); }
.mb-prev-tab.on image { color: #4a9bff; }
.mb-prev-card { background-color: rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 8px; }
.mb-prev-line { background-color: rgba(255, 255, 255, 0.18); border-radius: 3px; min-height: 5px; }
.mb-prev-label { color: rgba(255, 255, 255, 0.55); font-size: 8px; font-weight: 700; }
.mb-prev-btn { background-color: rgba(255, 255, 255, 0.07); border-radius: 6px; min-height: 18px; }
.mb-pill { border-radius: 14px; padding: 8px 10px; background-color: ${p.HOVER}; border: 1px solid transparent; }
.mb-pill:checked { background-color: ${p.ACCENT_SOFT}; }
.mb-tick { min-width: 16px; min-height: 16px; border-radius: 8px; border: 1px solid ${p.TEXT_DISABLED}; }
.mb-pill:checked .mb-tick { background-color: ${p.ACCENT}; border-color: ${p.ACCENT}; }
.mb-pill:checked .mb-tick image { color: white; }
.th-choice { padding: 8px; border-radius: 14px; border: 2px solid transparent; }
.th-choice:checked { border-color: ${p.ACCENT}; background-color: ${p.ACCENT_SOFT}; }
.th-picture { border-radius: 8px; }
.th-bar { min-height: 12px; border-radius: 8px 8px 0 0; background-color: rgba(128, 128, 128, 0.25); }
.th-system { background-image: linear-gradient(135deg, #f2f4f8 50%, #2b2b30 50%); }
.th-light { background-color: #f2f4f8; }
.th-dark { background-color: #2b2b30; }
.th-label { font-weight: 600; font-size: 12px; }
.th-choice:checked .th-label { color: ${p.ACCENT}; }
.mb-icon-choice { border-radius: 10px; padding: 8px; border: 2px solid transparent; background-color: ${p.HOVER}; }
.mb-icon-choice:checked { border-color: ${p.ACCENT}; background-color: ${p.ACCENT_SOFT}; }
`;

const WIDGET_ICONS = {
    media: 'folder-music-symbolic',
    calendar: 'x-office-calendar-symbolic',
    mirror: 'camera-web-symbolic',
    timer: 'alarm-symbolic',
    todo: 'checkbox-checked-symbolic',
    notes: 'document-edit-symbolic',
    shortcuts: 'view-app-grid-symbolic',
    awake: 'weather-clear-night-symbolic',
    displays: 'video-display-symbolic',
    utilities: 'applications-utilities-symbolic',
    controls: 'preferences-other-symbolic',
    toggles: 'view-list-symbolic',
    focus: 'preferences-system-time-symbolic',
    system: 'utilities-system-monitor-symbolic',
    network: 'network-wireless-symbolic',
    disks: 'drive-harddisk-symbolic',
    power: 'battery-full-symbolic',
    sound: 'audio-volume-high-symbolic',
    downloads: 'folder-download-symbolic',
    input: 'input-mouse-symbolic',
    windows: 'focus-windows-symbolic',
    workspaces: 'view-paged-symbolic',
    agents: 'system-run-symbolic',
    companion: 'face-smile-symbolic',
};

const ALL_APPEARANCE_KEYS = ['panel-color', 'panel-opacity', 'corner-radius', 'background-opacity', 'shadow-strength',
    'row-height', 'content-padding', 'widget-spacing', 'show-dividers'];

export default class OsminPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(980, 800);
        window.title = _('Osmin');
        window.search_enabled = false;

        this._installTheme();
        this._applyScheme(settings);
        settings.connect('changed::color-scheme', () => this._applyScheme(settings));

        const page = new Adw.PreferencesPage({title: _('Osmin'), icon_name: 'preferences-system-symbolic'});
        const group = new Adw.PreferencesGroup();
        const root = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['osmin-prefs']});
        group.add(root);
        page.add(group);
        window.add(page);

        const pages = [
            ['general', _('General'), 'preferences-system-symbolic', this._generalPage(settings)],
            ['monitor', _('Monitor'), 'utilities-system-monitor-symbolic', this._monitorPage(settings)],
            ['osmin', _('Osmin'), 'view-grid-symbolic', this._osminPage(settings)],
            ['tools', _('Menu bar'), 'window-new-symbolic', this._menuBarPage(settings)],
            ['appearance', _('Appearance'), 'applications-graphics-symbolic', this._appearancePage(settings)],
            ['gestures', _('Gestures'), 'input-touchpad-symbolic', this._gesturesPage(settings)],
            ['tray', _('Tray'), 'folder-download-symbolic', this._trayPage(settings)],
            ['clipboard', _('Clipboard'), 'edit-paste-symbolic', this._clipboardPage(settings)],
            ['activities', _('Live Activities'), 'media-playback-start-symbolic', this._activitiesPage(settings)],
            ['about', _('About'), 'help-about-symbolic', this._aboutPage()],
        ];

        const stack = new Gtk.Stack({
            transition_type: Gtk.StackTransitionType.CROSSFADE,
            transition_duration: 140,
            hexpand: true,
            vexpand: true,
        });
        const featuresPage = this._featuresPage(settings);
        const P = name => pages.find(p => p[0] === name)[3];
        const sections = [
            [_('Essentials'), [
                ['general', _('General'), 'preferences-system-symbolic', P('general')],
                ['tools', _('Menu bar'), 'window-new-symbolic', P('tools')],
                ['features', _('Features'), 'view-app-grid-symbolic', featuresPage],
                ['monitor', _('Monitor'), 'utilities-system-monitor-symbolic', P('monitor')],
            ]],
            [_('Utilities'), [
                ['command', _('Command Bar'), 'system-search-symbolic', this._commandPage(settings)],
                ['quickpanel', _('Quick panel'), 'starred-symbolic', this._quickPanelPage(settings)],
                ['toggles', _('Quick toggles'), 'emblem-system-symbolic', this._togglesPage(settings)],
                ['cleaning', _('Cleaning Mode'), 'input-keyboard-symbolic', this._cleaningPage(settings)],
                ['screenshot', _('Screenshot'), 'applets-screenshooter-symbolic', this._screenshotPage(settings)],
                ['camera', _('Camera preview'), 'camera-web-symbolic', this._cameraPage(settings)],
                ['scratchpad', _('Scratchpad'), 'accessories-text-editor-symbolic', this._scratchpadPage(settings)],
                ['color', _('Color picker'), 'color-select-symbolic', this._colorPage(settings)],
                ['radial', _('Radial menu'), 'view-app-grid-symbolic', this._radialPage(settings)],
            ]],
            [_('Sound'), [
                ['sound', _('Volume mixer'), 'audio-volume-high-symbolic', this._soundPage(settings)],
                ['output', _('Output switcher'), 'audio-speakers-symbolic', this._outputPage(settings)],
                ['mic', _('Mute microphone'), 'microphone-sensitivity-muted-symbolic', this._micPage(settings)],
            ]],
            [_('Dynamic Island'), [
                ['osmin', _('Widgets'), 'view-grid-symbolic', P('osmin')],
                ['appearance', _('Appearance'), 'applications-graphics-symbolic', P('appearance')],
                ['gestures', _('Gestures'), 'input-touchpad-symbolic', P('gestures')],
                ['activities', _('Live Activities'), 'media-playback-start-symbolic', P('activities')],
            ]],
            [_('Tabs'), [
                ['tray', _('Tray'), 'folder-download-symbolic', P('tray')],
                ['clipboard', _('Clipboard'), 'edit-paste-symbolic', P('clipboard')],
            ]],
            [_('Osmin'), [
                ['about', _('About'), 'help-about-symbolic', P('about')],
            ]],
        ];
        // What the blue "Try it" button of a page does.
        const TRY = {
            command: 'command', quickpanel: 'quickpanel', toggles: 'dark', cleaning: 'cleaning', screenshot: 'screenshot', color: 'color',
            mic: 'mic', radial: 'radial', output: 'output', sound: 'page-sound', tools: 'page-awake',
        };

        const sidebar = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['osmin-sidebar'], width_request: 236});
        const search = new Gtk.SearchEntry({placeholder_text: _('Search'), hexpand: true});
        sidebar.append(search);
        const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.SINGLE, vexpand: true});
        const rowsByName = new Map();
        const INTROS = {
            features: _('Everything Osmin can do. Each line says where it appears: in the window of the top-bar button, or in the capsule (the island).'),
            tools: '',
            osmin: _('Choose the widgets of the capsule (the island), their order and their width.'),
            appearance: _('The look of the capsule and the top bar.'),
            gestures: _('How the capsule opens, closes and reacts to the pointer and the touchpad.'),
            activities: _('What the capsule shows while something is going on, and for how long.'),
            tray: _('The file shelf: drag files to the top of the screen to keep them there.'),
            clipboard: _('The history of what you copy, and how it behaves.'),
            general: _('Size, shortcuts and where Osmin is shown.'),
            monitor: _('What the top bar and the panel show about this computer, and when to warn you.'),
            about: '',
        };
        for (const [heading, entries] of sections) {
            list.append(new Gtk.ListBoxRow({
                selectable: false,
                activatable: false,
                child: new Gtk.Label({label: heading, css_classes: ['caption-heading'], xalign: 0}),
            }));
            for (const [name, title, icon, content] of entries) {
                const page = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, css_classes: ['osmin-page'], hexpand: true});
                const head = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4, css_classes: ['osmin-page-head']});
                if (INTROS[name])
                    head.append(this._dim(INTROS[name]));
                page.append(head);
                content.margin_start = content.margin_end = 0;
                content.margin_top = 8;
                page.append(content);
                const clamp = new Adw.Clamp({maximum_size: 760, tightening_threshold: 600, child: page, valign: Gtk.Align.START, hexpand: true});
                const scroller = new Gtk.ScrolledWindow({child: clamp, hscrollbar_policy: Gtk.PolicyType.NEVER, vexpand: true, hexpand: true});
                stack.add_named(scroller, name);
                const row = new Gtk.ListBoxRow();
                row._page = name;
                row._title = title;
                const box = new Gtk.Box({spacing: 10});
                box.append(new Gtk.Image({icon_name: icon, pixel_size: 18}));
                box.append(new Gtk.Label({label: title, xalign: 0}));
                row.set_child(box);
                list.append(row);
                rowsByName.set(name, row);
            }
        }
        const heading = new Gtk.Label({css_classes: ['osmin-head-title'], xalign: 0, hexpand: true});
        const tryButton = new Gtk.Button({css_classes: ['osmin-try'], valign: Gtk.Align.CENTER});
        const tryBox = new Gtk.Box({spacing: 6});
        tryBox.append(new Gtk.Image({icon_name: 'media-playback-start-symbolic', pixel_size: 14}));
        tryBox.append(new Gtk.Label({label: _('Try it')}));
        tryButton.set_child(tryBox);
        let tryName = null;
        tryButton.connect('clicked', () => tryName && this._request(settings, tryName));
        const header = new Gtk.Box({spacing: 12, css_classes: ['osmin-head']});
        const history = [];
        let at = -1;
        let navigating = false;
        const back = Gtk.Button.new_from_icon_name('go-previous-symbolic');
        const forward = Gtk.Button.new_from_icon_name('go-next-symbolic');
        for (const b of [back, forward])
            b.add_css_class('flat');
        const syncNav = () => {
            back.sensitive = at > 0;
            forward.sensitive = at < history.length - 1;
        };
        const go = by => {
            const target = at + by;
            if (target < 0 || target >= history.length)
                return;
            at = target;
            navigating = true;
            list.select_row(rowsByName.get(history[at]));
            navigating = false;
            syncNav();
        };
        back.connect('clicked', () => go(-1));
        forward.connect('clicked', () => go(1));
        const nav = new Gtk.Box({css_classes: ['osmin-nav'], valign: Gtk.Align.CENTER});
        nav.append(back);
        nav.append(forward);
        header.append(nav);
        header.append(heading);
        header.append(tryButton);
        list.connect('row-selected', (_list, row) => {
            if (!row?._page)
                return;
            stack.set_visible_child_name(row._page);
            if (!navigating && history[at] !== row._page) {
                history.splice(at + 1);
                history.push(row._page);
                at = history.length - 1;
                syncNav();
            }
            heading.label = row._title;
            tryName = TRY[row._page] ?? null;
            tryButton.visible = !!tryName;
        });
        sidebar.append(list);
        list.select_row(rowsByName.get('general'));

        // Typing in the search field shows the features page, filtered.
        search.connect('search-changed', () => {
            list.select_row(rowsByName.get('features'));
            featuresPage._filter(search.text);
        });

        const layout = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, height_request: 720});
        const right = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true});
        right.append(header);
        right.append(stack);
        layout.append(sidebar);
        layout.append(right);
        root.append(layout);
    }

    // --- features ------------------------------------------------------------

    /**
     * Every feature of Osmin in one list, grouped, each with a switch and a line that says what it
     * does. A widget switch adds it to / removes it from the capsule; the others are settings.
     * The returned box has _filter(text) for the search field.
     */
    _featuresPage(settings) {
        const body = this._body();
        const rows = [];
        const TOOLS = _('Tools window (top-bar button)');
        const ISLAND = _('Island widgets (the capsule)');
        // The tools in the order of the tabs of their window, then the capsule's widgets.
        const MENU_ORDER = ['awake', 'displays', 'sound', 'system', 'network', 'disks', 'power', 'utilities', 'controls', 'toggles', 'windows', 'workspaces', 'focus', 'input', 'downloads', 'agents'];
        const rank = w => (w.menu ? MENU_ORDER.indexOf(w.id) : 100 + WIDGET_INFO.indexOf(w));
        const widgetRows = [...WIDGET_INFO].sort((a, b) => rank(a) - rank(b)).map(w => ({
            group: w.menu ? TOOLS : ISLAND,
            title: w.title,
            subtitle: w.subtitle,
            icon: WIDGET_ICONS[w.id] ?? 'applications-symbolic',
            widget: w.id,
        }));
        const key = (group, title, subtitle, icon, setting) => ({group, title, subtitle, icon, key: setting});
        const features = [
            ...widgetRows,
            key(_('Live Activities'), _('Music'), _('The playing track in the collapsed capsule'), 'folder-music-symbolic', 'activity-media'),
            key(_('Live Activities'), _('Timer'), _('A running countdown or focus session in the capsule'), 'alarm-symbolic', 'activity-timer'),
            key(_('Live Activities'), _('Calendar'), _('The next meeting, from 10 minutes before it'), 'x-office-calendar-symbolic', 'activity-calendar'),
            key(_('Live Activities'), _('Tray'), _('A card when files are added to the tray'), 'folder-download-symbolic', 'activity-files'),
            key(_('Live Activities'), _('Downloads'), _('Files arriving in the Downloads folder'), 'folder-download-symbolic', 'activity-downloads'),
            key(_('Cards and alerts'), _('System alerts'), _('A busy processor, heat, a full disk or memory, a low battery'), 'dialog-warning-symbolic', 'system-alerts'),
            key(_('Cards and alerts'), _('AI agents finished'), _('A card when Claude Code or Codex finishes a long task'), 'emblem-ok-symbolic', 'agents-alerts'),
            key(_('Cards and alerts'), _('Keyboard layout'), _('The capsule widens for a moment and shows the layout when you switch it'), 'input-keyboard-symbolic', 'show-input-source'),
            key(_('Cards and alerts'), _('Caps Lock'), _('The capsule shows whether Caps Lock is on or off'), 'input-keyboard-symbolic', 'show-caps-lock'),
            key(_('Music'), _('Lyrics'), _('The line being sung under the title (the song is looked up on lrclib.net)'), 'audio-x-generic-symbolic', 'show-lyrics'),
            key(_('Music'), _('Colored effects'), _('The effect takes the color of the album art'), 'applications-graphics-symbolic', 'colored-effects'),
            key(_('Clipboard'), _('Click pastes'), _('A click on an item pastes it into the app you were in'), 'edit-paste-symbolic', 'clipboard-click-pastes'),
            key(_('Clipboard'), _('Keep history'), _('Save everything you copied after a restart (pinned items and notes are always saved)'), 'document-save-symbolic', 'clipboard-keep-history'),
            key(_('Clipboard'), _('Clean links'), _('Remove tracking parameters (utm_*, fbclid ...) from copied links'), 'insert-link-symbolic', 'clipboard-clean-urls'),
            key(_('Files and sharing'), _('Keep the tray'), _('The files on the tray stay after a restart'), 'folder-download-symbolic', 'tray-keep-files'),
            key(_('Files and sharing'), _('Receive files with LocalSend'), _('This computer becomes visible to LocalSend devices (port 53317); every transfer asks first'), 'network-wireless-symbolic', 'localsend-receive'),
            key(_('Behaviour'), _('Open on hover'), _('The capsule opens when the pointer rests on it'), 'input-mouse-symbolic', 'open-on-hover'),
            key(_('Behaviour'), _('Collapse when the pointer leaves'), _('The open panel closes by itself'), 'view-restore-symbolic', 'auto-collapse'),
            key(_('Behaviour'), _('Swipe down to open'), _('A two-finger swipe down on the capsule opens it'), 'input-touchpad-symbolic', 'gestures-swipe-open'),
            key(_('Behaviour'), _('Swipe up to close'), _('A two-finger swipe up closes the panel'), 'input-touchpad-symbolic', 'gestures-swipe-close'),
            key(_('Behaviour'), _('Swipe to change tracks'), _('A sideways swipe on the capsule skips songs'), 'media-skip-forward-symbolic', 'gestures-media-swipe'),
            key(_('System'), _('Free Super+V from GNOME'), _('Lets you use Super+V for the Clipboard shortcut'), 'preferences-desktop-keyboard-shortcuts-symbolic', 'free-super-v'),
        ];

        // What a feature costs while it is on, said plainly (like "Nothing at rest").
        const COST = {
            windows: _('Nothing at rest'), workspaces: _('Nothing at rest'), awake: _('Nothing at rest'), displays: _('Nothing at rest'),
            utilities: _('Nothing at rest'), controls: _('Nothing at rest'), toggles: _('Nothing at rest'),
            focus: _('Nothing at rest'), input: _('Nothing at rest'), timer: _('Nothing at rest'),
            todo: _('Nothing at rest'), notes: _('Nothing at rest'), shortcuts: _('Nothing at rest'),
            system: _('Checks every 10 s'), network: _('Checks every 10 s'), disks: _('Checks every 10 s'), power: _('Checks every 10 s'),
            sound: _('Listens to the sound system'), downloads: _('Watches the folder'), agents: _('Checks on an interval'),
            media: _('Listens to players'), calendar: _('Checks on an interval'), mirror: _('Camera only while open'),
            companion: _('Follows the pointer'),
        };
        // Where a feature shows up, as a small badge after its name.
        const WHERE = {
            [TOOLS]: [_('Top-bar button'), ''],
            [ISLAND]: [_('Island'), 'island'],
            [_('Live Activities')]: [_('Island'), 'island'],
            [_('Cards and alerts')]: [_('Island'), 'island'],
        };
        const TONES = {
            [TOOLS]: '',
            [ISLAND]: 'purple',
            [_('Live Activities')]: 'green',
            [_('Cards and alerts')]: 'orange',
            [_('Music')]: 'purple',
            [_('Clipboard')]: '',
            [_('Files and sharing')]: 'green',
            [_('Behaviour')]: '',
            [_('System')]: 'red',
        };
        // A count and one-click sets, like a "start with a bundle" row.
        const WIDGET_IDS = WIDGET_INFO.map(w => w.id);
        const PRESETS = [
            [_('Everything'), _('Every tool and widget.'), WIDGET_IDS],
            [_('Essentials'), _('Windows, quick toggles, focus, system and sound, with music, calendar and mirror.'),
                ['media', 'calendar', 'mirror', 'awake', 'sound', 'system', 'utilities', 'toggles', 'windows']],
            [_('Light island'), _('Only music and calendar; the tools window is empty.'), ['media', 'calendar']],
        ];
        const summary = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['s-card'], margin_bottom: 6});
        const count = new Gtk.Label({xalign: 0, css_classes: ['s-row-title'], margin_top: 10, margin_bottom: 2});
        summary.append(count);
        const presets = new Gtk.Box({spacing: 10, homogeneous: true, margin_top: 6, margin_bottom: 12});
        for (const [name, text, ids] of PRESETS) {
            const card = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 4, css_classes: ['s-preset']});
            card.append(new Gtk.Label({label: name, css_classes: ['s-row-title'], xalign: 0}));
            const note = this._dim(text);
            note.wrap = true;
            note.vexpand = true;
            note.valign = Gtk.Align.START;
            card.append(note);
            card.append(this._button(_('Apply'), () => settings.set_strv('enabled-widgets', ids)));
            presets.append(card);
        }
        summary.append(presets);
        const syncCount = () => {
            const on = settings.get_strv('enabled-widgets').filter(id => WIDGET_IDS.includes(id)).length;
            count.label = _('%d of %d tools and widgets are on').format(on, WIDGET_IDS.length);
        };
        syncCount();
        settings.connect('changed::enabled-widgets', syncCount);
        body.append(new Gtk.Label({label: _('Start with a bundle'), css_classes: ['s-card-title'], xalign: 0, margin_start: 4}));
        body.append(summary);

        const grouped = new Map();
        for (const feature of features) {
            if (!grouped.has(feature.group))
                grouped.set(feature.group, []);
            grouped.get(feature.group).push(feature);
        }
        for (const [group, items] of grouped) {
            const heading = new Gtk.Label({label: group, css_classes: ['s-card-title'], xalign: 0, margin_start: 4});
            body.append(heading);
            const card = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['s-card']});
            body.append(card);
            const entries = [];
            items.forEach((feature, index) => {
                const wrap = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
                if (index > 0)
                    wrap.append(new Gtk.Separator());
                const row = new Gtk.Box({css_classes: ['s-row'], spacing: 12});
                const tile = new Gtk.Box({css_classes: ['s-tile', TONES[group] ?? ''], halign: Gtk.Align.START, valign: Gtk.Align.CENTER});
                tile.hexpand = false;
                tile.set_size_request(28, 28);
                tile.append(new Gtk.Image({icon_name: feature.icon, pixel_size: 15, hexpand: true, vexpand: true, halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER}));
                row.append(tile);
                const texts = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true, valign: Gtk.Align.CENTER, spacing: 2});
                const titleLine = new Gtk.Box({spacing: 8});
                titleLine.append(new Gtk.Label({label: feature.title, css_classes: ['s-row-title'], xalign: 0}));
                if (WHERE[group]) {
                    titleLine.append(new Gtk.Label({label: WHERE[group][0], css_classes: ['s-badge', WHERE[group][1]].filter(Boolean), valign: Gtk.Align.CENTER}));
                }
                texts.append(titleLine);
                texts.append(this._dim(feature.subtitle));
                row.append(texts);
                if (feature.widget && COST[feature.widget])
                    row.append(new Gtk.Label({label: COST[feature.widget], css_classes: ['dim-label', 's-cost'], valign: Gtk.Align.CENTER}));
                const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER});
                if (feature.widget) {
                    const sync = () => {
                        const on = settings.get_strv('enabled-widgets').includes(feature.widget);
                        if (toggle.active !== on)
                            toggle.active = on;
                    };
                    sync();
                    toggle.connect('notify::active', () => {
                        const list = settings.get_strv('enabled-widgets');
                        const has = list.includes(feature.widget);
                        if (toggle.active && !has)
                            settings.set_strv('enabled-widgets', [...list, feature.widget]);
                        else if (!toggle.active && has)
                            settings.set_strv('enabled-widgets', list.filter(id => id !== feature.widget));
                    });
                    settings.connect('changed::enabled-widgets', sync);
                } else {
                    settings.bind(feature.key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
                }
                row.append(toggle);
                wrap.append(row);
                card.append(wrap);
                entries.push({row: wrap, text: `${feature.title} ${feature.subtitle} ${group}`.toLowerCase()});
            });
            rows.push({heading, card, entries});
        }
        // The search field of the sidebar: only the matching features stay, and only their headings.
        body._filter = text => {
            const q = text.trim().toLowerCase();
            for (const {heading, card, entries} of rows) {
                let any = false;
                for (const {row, text: haystack} of entries) {
                    const match = q === '' || haystack.includes(q);
                    row.visible = match;
                    any = any || match;
                }
                heading.visible = any;
                card.visible = any;
            }
        };
        return body;
    }

    // --- theme --------------------------------------------------------------

    /** The settings window follows the system, or the light or dark choice made under General. */
    _applyScheme(settings) {
        const choice = settings.get_string('color-scheme');
        Adw.StyleManager.get_default().color_scheme = choice === 'light' ? Adw.ColorScheme.FORCE_LIGHT
            : choice === 'dark' ? Adw.ColorScheme.FORCE_DARK : Adw.ColorScheme.DEFAULT;
    }

    _installTheme() {
        const provider = new Gtk.CssProvider();
        const style = Adw.StyleManager.get_default();
        const apply = () => provider.load_from_string(buildCss(SETTINGS_THEME[style.dark ? 'dark' : 'light']));
        apply();
        style.connect('notify::dark', apply);
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION + 1);
    }

    // --- building blocks ------------------------------------------------------

    /** A page body: a centred column that the form helpers fill. */
    _body() {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 18,
            margin_bottom: 22,
            margin_start: 22,
            margin_end: 22,
        });
        return box;
    }

    /**
     * A page's list of settings: cards (rounded panels) with rows. `_row()` fills the current card;
     * `_rule()` ends it, so the next row starts a new card.
     */
    _form() {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12, hexpand: true});
        box._card = null;
        // Code written for a grid can still place a widget on a row of its own.
        box.attach = widget => {
            const card = this._cardOf(box);
            if (card._rows > 0)
                card.append(new Gtk.Separator());
            card._rows++;
            widget.hexpand = true;
            widget.margin_top = 10;
            widget.margin_bottom = 10;
            card.append(widget);
        };
        return box;
    }

    _cardOf(box) {
        if (!box._card) {
            box._card = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['s-card']});
            box._card._rows = 0;
            box.append(box._card);
        }
        return box._card;
    }

    _dim(text) {
        return new Gtk.Label({
            label: text,
            css_classes: ['dim'],
            wrap: true,
            xalign: 0,
            halign: Gtk.Align.START,
            max_width_chars: 52,
        });
    }

    /** One row of a card: the name (and a note under it) on the left, the control on the right. */
    _row(grid, label, control, note = '') {
        const card = this._cardOf(grid);
        if (card._rows > 0)
            card.append(new Gtk.Separator());
        card._rows++;
        const row = new Gtk.Box({css_classes: ['s-row'], spacing: 14});
        const texts = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true, valign: Gtk.Align.CENTER, spacing: 2});
        if (label)
            texts.append(new Gtk.Label({label, css_classes: ['s-row-title'], xalign: 0, wrap: true}));
        if (note)
            texts.append(this._dim(note));
        row.append(texts);
        const wide = control.compute_expand(Gtk.Orientation.HORIZONTAL) && !control._inline;
        control.halign = wide ? Gtk.Align.FILL : Gtk.Align.END;
        control.valign = Gtk.Align.CENTER;
        if (wide) {
            // A wide control (a slider, an editor) gets the row's width; the name goes above it.
            texts.hexpand = false;
            row.set_orientation(Gtk.Orientation.VERTICAL);
            row.set_spacing(6);
            control.hexpand = true;
        }
        row.append(control);
        card.append(row);
    }

    _rule(grid) {
        grid._card = null;
    }

    _switch(settings, key) {
        const sw = new Gtk.Switch({valign: Gtk.Align.CENTER});
        settings.bind(key, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
        return sw;
    }

    /** Slider with a boxed value, bound to a setting. */
    _slider(settings, key, [lower, upper, step], digits = 0, width = 170) {
        const adjustment = new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5});
        const box = new Gtk.Box({spacing: 10, halign: Gtk.Align.END});
        box._inline = true;
        const scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment,
            draw_value: false,
            hexpand: false,
            width_request: width,
        });
        const spin = new Gtk.SpinButton({adjustment, digits, css_classes: ['osmin-value'], width_chars: 4});
        settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        box.append(scale);
        box.append(spin);
        return box;
    }

    _button(label, onClick, destructive = false) {
        const button = new Gtk.Button({label, css_classes: destructive ? ['osmin-btn', 'destructive'] : ['osmin-btn']});
        button.connect('clicked', onClick);
        return button;
    }

    _resetRow(grid, settings, keys, label = _('Reset these settings')) {
        this._rule(grid);
        this._row(grid, _('Others'), this._button(label, () => keys.forEach(k => settings.reset(k))));
    }

    _segmented(items, onSelect) {
        const box = new Gtk.Box({css_classes: ['osmin-seg'], spacing: 2, halign: Gtk.Align.CENTER});
        let first = null;
        items.forEach(([id, title], i) => {
            const b = new Gtk.ToggleButton({label: title, group: first});
            first ??= b;
            b.connect('toggled', () => {
                if (b.active)
                    onSelect(id);
            });
            box.append(b);
            if (i === 0)
                b.active = true;
        });
        return box;
    }

    _icon(name) {
        const box = new Gtk.Box({css_classes: ['osmin-icon'], halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER});
        box.append(new Gtk.Image({icon_name: name, pixel_size: 18, hexpand: true, vexpand: true}));
        return box;
    }

    /** A pill with one chip per entry: coloured icon, name, caption, switch. */
    _chip({icon, title, caption, active, selected, sensitive = true, onToggle, onSelect}) {
        const chip = new Gtk.Box({css_classes: ['osmin-chip'], spacing: 10, hexpand: true, halign: Gtk.Align.FILL});
        if (selected)
            chip.add_css_class('selected');
        if (!active)
            chip.add_css_class('off');
        chip.append(this._icon(icon));

        const text = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, valign: Gtk.Align.CENTER, hexpand: true});
        text.append(new Gtk.Label({label: title, xalign: 0, css_classes: ['osmin-chip-title']}));
        if (caption)
            text.append(new Gtk.Label({label: caption, xalign: 0, css_classes: ['osmin-chip-sub']}));
        chip.append(text);

        const sw = new Gtk.Switch({active, valign: Gtk.Align.CENTER, sensitive});
        sw.connect('notify::active', () => onToggle(sw.active));
        chip.append(sw);

        if (onSelect) {
            const click = new Gtk.GestureClick();
            click.connect('released', () => onSelect());
            chip.add_controller(click);
        }
        return chip;
    }

    _strip() {
        const flow = new Gtk.FlowBox({
            css_classes: ['osmin-strip'],
            selection_mode: Gtk.SelectionMode.NONE,
            homogeneous: true,
            min_children_per_line: 1,
            max_children_per_line: 2,
            column_spacing: 4,
            row_spacing: 4,
            activate_on_single_click: false,
            valign: Gtk.Align.START,
            vexpand: false,
        });
        return flow;
    }

    // --- General ----------------------------------------------------------

    _generalPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);

        // Appearance: three small pictures, like the reference.
        form.append(new Gtk.Label({label: _('Appearance'), css_classes: ['s-card-title'], xalign: 0, margin_start: 4}));
        const thumbs = new Gtk.Box({spacing: 12, homogeneous: true, margin_top: 8, margin_bottom: 8, margin_start: 12, margin_end: 12});
        let group = null;
        const choices = new Map();
        for (const [id, title] of [['system', _('System')], ['light', _('Light')], ['dark', _('Dark')]]) {
            const button = new Gtk.ToggleButton({css_classes: ['th-choice', 'flat'], group});
            group ??= button;
            const column = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
            const picture = new Gtk.Box({css_classes: ['th-picture', `th-${id}`], height_request: 74});
            const bar = new Gtk.Box({css_classes: ['th-bar'], valign: Gtk.Align.START, hexpand: true});
            picture.append(bar);
            column.append(picture);
            column.append(new Gtk.Label({label: title, css_classes: ['th-label']}));
            button.set_child(column);
            button.connect('toggled', () => {
                if (button.active)
                    settings.set_string('color-scheme', id);
            });
            choices.set(id, button);
            thumbs.append(button);
        }
        const syncScheme = () => (choices.get(settings.get_string('color-scheme')) ?? group).set_active(true);
        syncScheme();
        settings.connect('changed::color-scheme', syncScheme);
        form.attach(thumbs);
        form.append(this._dim(_('Applies to the settings window of Osmin, not to the whole desktop.')));
        this._rule(form);

        this._toggleRow(form, settings, 'open-on-hover', _('Osmin'), _('Open on hover'),
            _('Off: the capsule opens on click only.'));
        this._toggleRow(form, settings, 'auto-collapse', '', _('Collapse when the pointer leaves'),
            _('Off: it stays open until you close it.'));

        this._rule(form);
        this._row(form, _('Collapsed width'), this._slider(settings, 'collapsed-width-adjust', [-30, 80, 1]),
            _('Fine tune the width of the collapsed capsule, in pixels.'));
        this._row(form, _('Animation speed'), this._slider(settings, 'animation-speed', [0.5, 2.0, 0.1], 1),
            _('Higher is faster.'));

        this._rule(form);
        for (const [key, title] of [
            ['shortcut-osmin', _('Osmin')], ['shortcut-tray', _('Tray')],
            ['shortcut-clipboard', _('Clipboard')], ['shortcut-alerts', _('Alerts')], ['shortcut-command', _('Search')],
        ]) {
            if (key === 'shortcut-osmin')
                form.append(new Gtk.Label({label: _('Shortcuts'), css_classes: ['s-card-title'], xalign: 0, margin_start: 4}));
            this._row(form, title, this._shortcutButton(settings, key),
                key === 'shortcut-osmin' ? _('Open the panel on a section. Press the same keys again to close it. Backspace clears, Esc cancels.') : '');
        }

        this._toggleRow(form, settings, 'localsend-receive', _('LocalSend'), _('Receive files'),
            _('Makes this computer visible to LocalSend devices on your network (port 53317). Every transfer must be accepted in a card first; files are saved in Downloads. Close the LocalSend app first: only one can listen.'));
        this._toggleRow(form, settings, 'free-super-v', '', _('Free Super+V from GNOME'),
            _('GNOME opens its notification list on Super+V, so you cannot record it. This takes that binding away while Osmin is enabled and gives it back when Osmin is disabled. Turn it on first, then record Super+V.'));

        this._shortcutPair(form, settings, 'shortcut-awake', '<Control><Alt><Super>k', _('Enable shortcut for “Keep awake”'));
        this._hint(form, _('Works in any app, no extra permissions.'));
        this._rule(form);
        this._row(form, _('Feedback'), this._button(_('Send feedback'), () => Gio.AppInfo.launch_default_for_uri('https://github.com/bekov0004/Osmin/issues/new', null)),
            _('Send a bug report or a feature idea directly to the person who maintains Osmin.'));

        this._rule(form);
        this._row(form, _('Show on'), this._monitorsEditor(settings),
            _('The monitors that get a capsule. "Primary" follows the monitor GNOME calls primary; the top bar is only there.'));

        this._resetRow(form, settings, settings.settings_schema.list_keys(), _('Reset all settings'));
        return body;
    }

    /** A button that records a key combination into an `as` setting (empty = none). */
    _shortcutButton(settings, key) {
        const button = new Gtk.Button({halign: Gtk.Align.START, width_request: 160});
        let recording = false;
        const show = () => {
            const [accel] = settings.get_strv(key);
            button.label = recording ? _('Press keys…')
                : accel ? Gtk.accelerator_get_label(...Gtk.accelerator_parse(accel).slice(1)) : _('Not set');
        };
        const stop = () => {
            recording = false;
            show();
        };
        button.connect('clicked', () => {
            recording = true;
            show();
            button.grab_focus();
        });
        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c, keyval, _keycode, state) => {
            if (!recording)
                return false;
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            if (keyval === Gdk.KEY_Escape && mods === 0) {
                stop();
                return true;
            }
            if (keyval === Gdk.KEY_BackSpace && mods === 0) {
                settings.set_strv(key, []);
                stop();
                return true;
            }
            // A bare modifier (or a key that cannot make a shortcut) keeps waiting.
            if (mods === 0 || !Gtk.accelerator_valid(keyval, mods))
                return true;
            settings.set_strv(key, [Gtk.accelerator_name(keyval, mods)]);
            stop();
            return true;
        });
        button.add_controller(keys);
        const focus = new Gtk.EventControllerFocus();
        focus.connect('leave', stop);
        button.add_controller(focus);
        const changedId = settings.connect(`changed::${key}`, show);
        button.connect('destroy', () => settings.disconnect(changedId));
        show();
        return button;
    }

    /** One switch per connected monitor (and one for "the primary one"); the choice is a list of connector names. */
    _monitorsEditor(settings) {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        const entries = [['primary', _('Primary monitor')]];
        const monitors = Gdk.Display.get_default()?.get_monitors();
        for (let i = 0; monitors && i < monitors.get_n_items(); i++) {
            const monitor = monitors.get_item(i);
            const connector = monitor.get_connector();
            if (!connector)
                continue;
            const geometry = monitor.get_geometry();
            const name = [monitor.get_manufacturer(), monitor.get_model()].filter(Boolean).join(' ');
            entries.push([connector, `${connector}${name ? ` · ${name}` : ''} · ${geometry.width}×${geometry.height}`]);
        }
        // Monitors that are chosen but not connected now stay in the list, so unplugging a screen forgets nothing.
        for (const id of settings.get_strv('monitors')) {
            if (!entries.some(([entry]) => entry === id))
                entries.push([id, `${id} · ${_('not connected')}`]);
        }

        const update = (id, on) => {
            const chosen = settings.get_strv('monitors').filter(entry => entry !== id);
            if (on)
                chosen.push(id);
            // Never leave the list empty: Osmin would have nowhere to be.
            settings.set_strv('monitors', chosen.length > 0 ? chosen : ['primary']);
        };
        const switches = new Map();
        const sync = () => {
            const chosen = settings.get_strv('monitors');
            for (const [id, toggle] of switches) {
                if (toggle.active !== chosen.includes(id))
                    toggle.active = chosen.includes(id);
            }
        };
        for (const [id, label] of entries) {
            const row = new Gtk.Box({spacing: 10});
            const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER, active: settings.get_strv('monitors').includes(id)});
            toggle.connect('notify::active', () => {
                if (toggle.active !== settings.get_strv('monitors').includes(id))
                    update(id, toggle.active);
            });
            switches.set(id, toggle);
            row.append(toggle);
            row.append(new Gtk.Label({label}));
            box.append(row);
        }
        const changedId = settings.connect('changed::monitors', sync);
        box.connect('destroy', () => settings.disconnect(changedId));
        return box;
    }

    /** "[switch] Title" with an optional note below, like the checkbox rows of the reference. */
    /**
     * A switch row: the name and the note on the left, the switch on the right. A `label` (the group
     * it belongs to) becomes a small heading above its card when it starts one.
     */
    _toggleRow(grid, settings, key, label, title, note = '') {
        if (label && !grid._card)
            grid.append(new Gtk.Label({label, css_classes: ['s-card-title'], xalign: 0, margin_start: 4}));
        this._row(grid, title, this._switch(settings, key), note);
    }

    /** "Detected" apps on the left, the ones "In use" on the right. */
    _shortcutsEditor(settings) {
        const editor = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, margin_top: 10});
        const head = new Gtk.Box({spacing: 10});
        head.append(new Gtk.Label({label: _('Shortcuts'), css_classes: ['osmin-page-title']}));
        head.append(new Gtk.Separator({hexpand: true, valign: Gtk.Align.CENTER}));
        editor.append(head);

        const columns = new Gtk.Box({spacing: 10, homogeneous: true});
        editor.append(columns);

        const makeList = title => {
            const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
            box.append(new Gtk.Label({label: title, xalign: 0, css_classes: ['osmin-chip-title']}));
            const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, css_classes: ['osmin-panel']});
            const scroll = new Gtk.ScrolledWindow({
                child: list,
                min_content_height: 240,
                max_content_height: 240,
                hscrollbar_policy: Gtk.PolicyType.NEVER,
                vexpand: false,
            });
            box.append(scroll);
            columns.append(box);
            return list;
        };
        const detected = makeList(_('Detected'));
        const inUse = makeList(_('In use'));

        const clear = box => {
            let child;
            while ((child = box.get_first_child()))
                box.remove(child);
        };
        const appRow = (app, buttons) => {
            const row = new Gtk.Box({spacing: 8, margin_top: 2, margin_bottom: 2});
            row.append(new Gtk.Image({gicon: app.get_icon() ?? Gio.ThemedIcon.new('application-x-executable'),
                pixel_size: 22}));
            row.append(new Gtk.Label({label: app.get_name(), xalign: 0, hexpand: true,
                ellipsize: 3, max_width_chars: 16}));
            for (const b of buttons)
                row.append(b);
            return row;
        };

        const rebuild = () => {
            const used = settings.get_strv('shortcut-apps');
            clear(detected);
            clear(inUse);

            const all = Gio.AppInfo.get_all()
                .filter(app => app.should_show() && app.get_id() && !used.includes(app.get_id()))
                .sort((a, b) => a.get_name().localeCompare(b.get_name()));
            for (const app of all) {
                detected.append(appRow(app, [this._button(_('Use'), () => {
                    settings.set_strv('shortcut-apps', [...settings.get_strv('shortcut-apps'), app.get_id()]);
                })]));
            }

            const apps = used.map(id => Gio.DesktopAppInfo.new(id)).filter(Boolean);
            if (apps.length === 0) {
                inUse.append(new Gtk.Label({label: _('Select some shortcuts'), css_classes: ['dim'],
                    vexpand: true, valign: Gtk.Align.CENTER, margin_top: 90}));
            }
            apps.forEach((app, i) => {
                const move = (delta) => {
                    const ids = settings.get_strv('shortcut-apps');
                    const j = i + delta;
                    if (j < 0 || j >= ids.length)
                        return;
                    [ids[i], ids[j]] = [ids[j], ids[i]];
                    settings.set_strv('shortcut-apps', ids);
                };
                const up = new Gtk.Button({icon_name: 'go-up-symbolic', css_classes: ['flat'], sensitive: i > 0});
                const down = new Gtk.Button({icon_name: 'go-down-symbolic', css_classes: ['flat'],
                    sensitive: i < apps.length - 1});
                const remove = new Gtk.Button({icon_name: 'window-close-symbolic', css_classes: ['flat']});
                up.connect('clicked', () => move(-1));
                down.connect('clicked', () => move(1));
                remove.connect('clicked', () => {
                    settings.set_strv('shortcut-apps', settings.get_strv('shortcut-apps').filter(id => id !== app.get_id()));
                });
                inUse.append(appRow(app, [up, down, remove]));
            });
        };
        const id = settings.connect('changed::shortcut-apps', rebuild);
        editor.connect('destroy', () => settings.disconnect(id));
        rebuild();
        return editor;
    }

    // --- Osmin (widgets) -----------------------------------------------------

    _osminPage(settings) {
        const body = this._body();
        const sub = this._segmented([
            ['widgets', _('Customize widgets')],
            ['width', _('Capsule width')],
        ], id => substack.set_visible_child_name(id));
        body.append(sub);

        const substack = new Gtk.Stack({vexpand: true});
        body.append(substack);
        substack.add_named(this._widgetsView(settings), 'widgets');
        substack.add_named(this._widthView(settings), 'width');
        return body;
    }

    /** The tabs of the top-bar button's window: which tools, and in what order. */
    _toolsPage(settings) {
        const body = this._body();
        body.append(this._widgetsView(settings, {menu: true}));
        return body;
    }

    _widthView(settings) {
        const form = this._form();
        const modes = ['auto', 'fixed'];
        const mode = new Gtk.DropDown({model: Gtk.StringList.new([_('Auto'), _('Fixed')])});
        mode.selected = Math.max(0, modes.indexOf(settings.get_string('width-mode')));
        mode.connect('notify::selected', () => settings.set_string('width-mode', modes[mode.selected]));
        settings.connect('changed::width-mode', () => {
            mode.selected = Math.max(0, modes.indexOf(settings.get_string('width-mode')));
        });
        this._row(form, _('Width mode'), mode, _('Auto follows the widgets; fixed is a share of the screen.'));

        const fixed = this._slider(settings, 'fixed-width', [0.25, 0.9, 0.05], 2);
        const syncFixed = () => {
            fixed.sensitive = settings.get_string('width-mode') === 'fixed';
        };
        settings.connect('changed::width-mode', syncFixed);
        syncFixed();
        this._row(form, _('Fixed width'), fixed, _('Share of the screen width (fixed mode).'));

        this._rule(form);
        this._row(form, _('Widget size'), this._slider(settings, 'size-scale', [0.85, 1.25, 0.05], 2),
            _('Scales the width of every cell.'));
        this._resetRow(form, settings, ['width-mode', 'fixed-width', 'size-scale']);
        return form;
    }

    _widgetsView(settings, {menu = false} = {}) {
        const INFO = WIDGET_INFO.filter(w => !!w.menu === menu);
        const view = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 14});

        // Preview: the capsule with one block per enabled widget.
        const capsule = new Gtk.Box({
            css_classes: ['osmin-capsule'],
            spacing: 8,
            halign: Gtk.Align.CENTER,
            homogeneous: false,
        });
        const previewHolder = new Gtk.Box({css_classes: ['osmin-panel'], halign: Gtk.Align.FILL, hexpand: true});
        capsule.hexpand = false;
        previewHolder.append(capsule);
        capsule.halign = Gtk.Align.CENTER;
        capsule.hexpand = true;
        if (!menu)
            view.append(previewHolder);

        const strip = this._strip();
        view.append(strip);

        const options = this._form();
        view.append(options);

        const readCells = () => {
            const value = settings.get_value('widget-cells').recursiveUnpack();
            return Object.fromEntries(WIDGET_INFO.map(w => [w.id, Number(value[w.id]) || w.cells]));
        };
        const enabled = () => {
            const ids = [];
            for (const id of settings.get_strv('enabled-widgets')) {
                if (INFO.some(w => w.id === id) && !ids.includes(id))
                    ids.push(id);
            }
            return ids.length > 0 || menu ? ids : DEFAULT_WIDGETS.filter(id => INFO.some(w => w.id === id));
        };
        // The list also holds the other group's widgets: keep them as they are.
        const saveEnabled = ids => {
            const others = settings.get_strv('enabled-widgets').filter(id => !INFO.some(w => w.id === id));
            settings.set_strv('enabled-widgets', menu ? [...ids, ...others] : [...ids, ...others]);
        };
        let selected = enabled()[0] ?? INFO[0].id;

        const clear = box => {
            let child;
            while ((child = box.get_first_child()))
                box.remove(child);
        };

        const rebuildPreview = () => {
            clear(capsule);
            const cells = readCells();
            for (const id of enabled()) {
                const info = WIDGET_INFO.find(w => w.id === id);
                const block = new Gtk.Box({
                    css_classes: ['osmin-capsule-block'],
                    orientation: Gtk.Orientation.VERTICAL,
                    valign: Gtk.Align.CENTER,
                    spacing: 4,
                });
                block.set_size_request(cells[id] * 22, -1);
                block.append(new Gtk.Image({icon_name: WIDGET_ICONS[id], pixel_size: 16, vexpand: true,
                    valign: Gtk.Align.END}));
                block.append(new Gtk.Label({label: _(info.title), wrap: true, vexpand: true,
                    valign: Gtk.Align.START, justify: Gtk.Justification.CENTER}));
                capsule.append(block);
            }
        };

        const rebuildOptions = () => {
            clear(options);
            options._row = 0;
            const info = WIDGET_INFO.find(w => w.id === selected);
            const on = enabled();
            const isOn = on.includes(selected);
            const cells = readCells();

            const spin = new Gtk.Adjustment({
                lower: info.minCells, upper: 12, step_increment: 1, page_increment: 1, value: cells[selected],
            });
            const box = new Gtk.Box({spacing: 10, hexpand: true, halign: Gtk.Align.FILL});
            const scale = new Gtk.Scale({
                adjustment: spin, draw_value: false, hexpand: true, width_request: 230,
                sensitive: isOn, digits: 0,
            });
            scale.set_round_digits(0);
            const value = new Gtk.SpinButton({adjustment: spin, css_classes: ['osmin-value'], width_chars: 3,
                sensitive: isOn});
            spin.connect('value-changed', () => {
                const next = readCells();
                const v = Math.round(spin.get_value());
                if (next[selected] === v)
                    return;
                next[selected] = v;
                settings.set_value('widget-cells', new GLib.Variant('a{si}', next));
            });
            box.append(scale);
            box.append(value);
            if (!menu)
                this._row(options, _('Width'), box, _('Width of %s, in cells.').format(_(info.title)));

            const moves = new Gtk.Box({spacing: 6});
            const index = on.indexOf(selected);
            const left = this._button(_('Move left'), () => move(-1));
            const right = this._button(_('Move right'), () => move(1));
            left.sensitive = isOn && index > 0;
            right.sensitive = isOn && index < on.length - 1;
            moves.append(left);
            moves.append(right);
            this._row(options, _('Position'), moves, menu ? _('The order of the tabs in the window.') : _('The order of the widgets in the capsule.'));

            if (selected === 'shortcuts') {
                const cols = new Gtk.Box({spacing: 18});
                let firstRadio = null;
                for (const [n, title] of [[1, _('1 Column')], [2, _('2 Columns')]]) {
                    const radio = new Gtk.CheckButton({label: title, group: firstRadio});
                    firstRadio ??= radio;
                    radio.active = settings.get_int('shortcut-columns') === n;
                    radio.connect('toggled', () => {
                        if (radio.active)
                            settings.set_int('shortcut-columns', n);
                    });
                    cols.append(radio);
                }
                this._row(options, _('Columns'), cols, _('Each column contains 2 rows (2 shortcuts).'));
                const r = options._row++;
                options.attach(this._shortcutsEditor(settings), 0, r, 2, 1);
            }

            this._resetRow(options, settings, ['enabled-widgets', 'widget-cells', 'shortcut-apps',
                'shortcut-columns']);
        };

        const move = delta => {
            const ids = enabled();
            const i = ids.indexOf(selected);
            const j = i + delta;
            if (i < 0 || j < 0 || j >= ids.length)
                return;
            [ids[i], ids[j]] = [ids[j], ids[i]];
            saveEnabled(ids);
        };

        const rebuildStrip = () => {
            clear(strip);
            const on = enabled();
            const ordered = [...on, ...INFO.map(w => w.id).filter(id => !on.includes(id))];
            const cells = readCells();
            for (const id of ordered) {
                const info = WIDGET_INFO.find(w => w.id === id);
                const isOn = on.includes(id);
                strip.append(this._chip({
                    icon: WIDGET_ICONS[id],
                    title: _(info.title),
                    caption: isOn ? (menu ? _('Tab') : _('%d cells').format(cells[id])) : _('Off'),
                    active: isOn,
                    selected: id === selected,
                    sensitive: menu || !(isOn && on.length <= 1),
                    onToggle: active => {
                        const ids = enabled();
                        if (active && !ids.includes(id))
                            ids.push(id);
                        else if (!active && (menu || ids.length > 1))
                            ids.splice(ids.indexOf(id), 1);
                        else
                            return;
                        selected = id;
                        saveEnabled(ids);
                    },
                    onSelect: () => {
                        selected = id;
                        refresh();
                    },
                }));
            }
        };

        const refresh = () => {
            rebuildStrip();
            rebuildPreview();
            rebuildOptions();
        };
        settings.connect('changed::enabled-widgets', refresh);
        // Cells change while the slider is dragged: only refresh the pieces that show them.
        settings.connect('changed::widget-cells', () => {
            rebuildStrip();
            rebuildPreview();
        });
        refresh();
        return view;
    }

    // --- Appearance ---------------------------------------------------------

    _appearancePage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);

        this._row(form, _('Corner radius'), this._slider(settings, 'corner-radius', [8, 44, 1]),
            _('In pixels.'));
        this._row(form, _('Transparency'), this._slider(settings, 'background-opacity', [0.5, 1.0, 0.02], 2),
            _('Background opacity: 1.00 is fully opaque.'));
        this._row(form, _('Shadow'), this._slider(settings, 'shadow-strength', [0, 1, 0.1], 1),
            _('0 turns the shadow off.'));

        this._rule(form);
        const picker = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog({with_alpha: false})});
        const parse = hex => {
            const rgba = new Gdk.RGBA();
            return rgba.parse(hex) ? rgba : null;
        };
        const toHex = rgba => '#' + [rgba.red, rgba.green, rgba.blue]
            .map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
        picker.rgba = parse(settings.get_string('panel-color')) ?? parse('#000000');
        picker.connect('notify::rgba', () => {
            const hex = toHex(picker.rgba);
            if (hex !== settings.get_string('panel-color'))
                settings.set_string('panel-color', hex);
        });
        settings.connect('changed::panel-color', () => {
            const rgba = parse(settings.get_string('panel-color'));
            if (rgba && toHex(rgba) !== toHex(picker.rgba))
                picker.rgba = rgba;
        });
        this._row(form, _('Top bar color'), picker, _('The color of the GNOME top bar while Osmin is on.'));
        this._row(form, _('Top bar opacity'), this._slider(settings, 'panel-opacity', [0, 1, 0.05], 2),
            _('0 is fully transparent, 1 is solid.'));

        this._rule(form);
        this._row(form, _('Height'), this._slider(settings, 'row-height', [90, 220, 2]),
            _('Height of the widget area, in pixels.'));
        this._row(form, _('Padding'), this._slider(settings, 'content-padding', [6, 32, 1]),
            _('Space around the widgets.'));
        this._row(form, _('Spacing'), this._slider(settings, 'widget-spacing', [0, 40, 1]),
            _('Space between widgets.'));

        this._rule(form);
        this._toggleRow(form, settings, 'show-dividers', _('Widgets'), _('Dividers'),
            _('Thin lines between widgets.'));
        this._toggleRow(form, settings, 'system-alerts', '', _('System alerts'),
            _('Cards for a busy processor, heat, a full disk or memory and low batteries (also of keyboards and mice).'));

        this._resetRow(form, settings, ALL_APPEARANCE_KEYS);
        return body;
    }



    // --- Menu bar -----------------------------------------------------------

    /**
     * The tabs of the top-bar window as one list: a handle to drag a row, an icon, a name and a
     * line about it, a switch. On the left a small picture of the button and the window; under
     * the list the icon of the button.
     */
    _menuBarPage(settings) {
        const body = this._body();
        const menuInfo = WIDGET_INFO.filter(w => w.menu);
        const MENU_ORDER = ['awake', 'displays', 'sound', 'system', 'network', 'disks', 'power', 'utilities', 'controls', 'toggles', 'windows', 'workspaces', 'focus', 'input', 'downloads', 'agents'];
        const info = id => menuInfo.find(w => w.id === id);
        const SHORT = {
            awake: _('Keeps your computer awake for as long as you want.'), displays: _('Brightness of your screens.'),
            sound: _('Volume of each app, one slider each.'), system: _('Processor, graphics and memory at a glance.'),
            network: _('Internet speed and its graph.'), disks: _('Free space and disk activity.'),
            power: _('Battery, charging and power use.'), utilities: _('Screenshots, colour picker and other tools.'),
            controls: _('Switches for mouse, keyboard and windows.'), toggles: _('Dark mode, microphone, trash and more.'),
            windows: _('Live previews, snap and move windows.'), workspaces: _('Create, switch and remove desktops.'),
            focus: _('A focus timer and a stopwatch.'), input: _('Mouse and keyboard switches.'),
            downloads: _('Files arriving in Downloads.'), agents: _('Claude Code and Codex at work.'),
        };
        const card = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['mb-card'], spacing: 6});
        body.append(card);
        card.append(new Gtk.Label({label: _('Menu bar'), css_classes: ['mb-title'], xalign: 0}));
        card.append(this._dim(_('Click the Osmin icon in the top bar to open the window. Its tabs appear in this order.')));

        const columns = new Gtk.Box({spacing: 20, margin_top: 10});
        card.append(columns);
        const left = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, valign: Gtk.Align.START, width_request: 250});
        const right = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true});
        columns.append(left);
        columns.append(right);

        const enabledIds = () => settings.get_strv('enabled-widgets');
        const menuOrder = () => {
            const on = enabledIds().filter(id => info(id));
            const off = MENU_ORDER.filter(id => info(id) && !on.includes(id));
            return {on, off};
        };
        const save = on => {
            const island = enabledIds().filter(id => !info(id));
            settings.set_strv('enabled-widgets', [...island, ...on]);
        };

        // The picture.
        const preview = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        left.append(preview);
        left.append(this._dim(_('Drag to reorder. Switch off anything you do not need.')));

        const fill = () => {
            for (let child = preview.get_first_child(); child; child = preview.get_first_child())
                preview.remove(child);
            const bar = new Gtk.Box({css_classes: ['mb-prev-bar'], spacing: 8, halign: Gtk.Align.FILL});
            bar.append(new Gtk.Box({hexpand: true}));
            ['network-wireless-symbolic', 'battery-full-symbolic'].forEach(n => bar.append(new Gtk.Image({icon_name: n, pixel_size: 12})));
            const mark = new Gtk.Box({css_classes: ['mb-prev-icon']});
            mark.append(new Gtk.Image({icon_name: settings.get_string('bar-icon'), pixel_size: 12}));
            bar.append(mark);
            preview.append(bar);
            const win = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['mb-prev-win'], spacing: 8, margin_start: 18});
            const tabs = new Gtk.Box({spacing: 2, halign: Gtk.Align.CENTER});
            menuOrder().on.forEach((id, i) => {
                const tab = new Gtk.Box({css_classes: i === 0 ? ['mb-prev-tab', 'on'] : ['mb-prev-tab']});
                tab.append(new Gtk.Image({icon_name: WIDGET_ICONS[id] ?? 'applications-symbolic', pixel_size: 11}));
                tabs.append(tab);
            });
            win.append(tabs);
            const first = menuOrder().on[0];
            const page = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['mb-prev-card'], spacing: 6});
            page.append(new Gtk.Label({label: (info(first)?.title ?? '').toUpperCase(), css_classes: ['mb-prev-label'], xalign: 0}));
            for (let i = 0; i < 3; i++)
                page.append(new Gtk.Box({css_classes: ['mb-prev-line'], margin_end: i * 24}));
            win.append(page);
            const footer = new Gtk.Box({spacing: 6, homogeneous: true});
            footer.append(new Gtk.Box({css_classes: ['mb-prev-btn']}));
            footer.append(new Gtk.Box({css_classes: ['mb-prev-btn']}));
            win.append(footer);
            preview.append(win);
        };

        // The list.
        const list = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        right.append(list);
        const build = () => {
            for (let child = list.get_first_child(); child; child = list.get_first_child())
                list.remove(child);
            const {on, off} = menuOrder();
            [...on, ...off].forEach((id, index) => {
                const enabled = on.includes(id);
                const row = new Gtk.Box({css_classes: enabled ? ['mb-row'] : ['mb-row', 'off'], spacing: 10});
                const handle = new Gtk.Image({icon_name: 'list-drag-handle-symbolic', pixel_size: 14, css_classes: ['mb-handle'], valign: Gtk.Align.CENTER});
                row.append(handle);
                const square = new Gtk.Box({css_classes: ['mb-square'], halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER});
                square.append(new Gtk.Image({icon_name: WIDGET_ICONS[id] ?? 'applications-symbolic', pixel_size: 20, hexpand: true, vexpand: true}));
                row.append(square);
                const texts = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, hexpand: true, valign: Gtk.Align.CENTER});
                texts.append(new Gtk.Label({label: info(id).title, css_classes: ['mb-name'], xalign: 0}));
                texts.append(new Gtk.Label({label: SHORT[id] ?? info(id).subtitle, css_classes: ['mb-desc'], xalign: 0, wrap: true, max_width_chars: 34}));
                row.append(texts);
                const toggle = new Gtk.Switch({active: enabled, valign: Gtk.Align.CENTER});
                toggle.connect('notify::active', () => {
                    const state = menuOrder();
                    save(toggle.active ? [...state.on, id] : state.on.filter(i => i !== id));
                });
                row.append(toggle);

                if (enabled) {
                    // Drag a row onto another to put it there.
                    const drag = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
                    drag.connect('prepare', () => Gdk.ContentProvider.new_for_value(id));
                    drag.connect('drag-begin', (_s, d) => Gtk.DragIcon.get_for_drag(d).set_child(new Gtk.Label({label: info(id).title, css_classes: ['mb-name'], margin_start: 8, margin_end: 8})));
                    handle.add_controller(drag);
                    const drop = new Gtk.DropTarget({actions: Gdk.DragAction.MOVE});
                    drop.set_gtypes([GObject.TYPE_STRING]);
                    drop.connect('enter', () => {
                        row.add_css_class('drop');
                        return Gdk.DragAction.MOVE;
                    });
                    drop.connect('leave', () => row.remove_css_class('drop'));
                    drop.connect('drop', (_t, value) => {
                        row.remove_css_class('drop');
                        const state = menuOrder().on.filter(i => i !== value);
                        state.splice(state.indexOf(id) + (menuOrder().on.indexOf(value) < menuOrder().on.indexOf(id) ? 1 : 0), 0, value);
                        save(state);
                        return true;
                    });
                    row.add_controller(drop);
                } else {
                    handle.opacity = 0.3;
                }
                list.append(row);
                if (index < on.length + off.length - 1)
                    list.append(new Gtk.Separator({opacity: 0.4}));
            });
        };
        build();
        fill();
        settings.connect('changed::enabled-widgets', () => {
            build();
            fill();
        });

        // The icon of the button.
        const iconCard = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, css_classes: ['mb-card'], spacing: 8, margin_top: 4});
        body.append(iconCard);
        iconCard.append(new Gtk.Label({label: _('Menu bar icon'), css_classes: ['mb-title'], xalign: 0}));
        iconCard.append(this._dim(_('The icon of the Osmin button in the top bar.')));
        const grid = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, max_children_per_line: 10, min_children_per_line: 10, homogeneous: true, column_spacing: 6, row_spacing: 6, margin_top: 6});
        const ICONS = ['view-app-grid-symbolic', 'view-grid-symbolic', 'applications-system-symbolic', 'preferences-system-symbolic', 'weather-clear-night-symbolic', 'starred-symbolic',
            'emblem-favorite-symbolic', 'input-gaming-symbolic', 'media-playback-start-symbolic', 'camera-photo-symbolic', 'audio-headphones-symbolic', 'utilities-terminal-symbolic',
            'user-home-symbolic', 'folder-symbolic', 'mail-unread-symbolic', 'network-workgroup-symbolic', 'system-search-symbolic', 'weather-clear-symbolic',
            'face-smile-symbolic', 'bookmark-new-symbolic', 'dialog-information-symbolic', 'security-high-symbolic', 'view-more-symbolic', 'go-home-symbolic',
            'tools-symbolic', 'applications-science-symbolic', 'applications-games-symbolic', 'applications-multimedia-symbolic', 'applications-engineering-symbolic', 'applications-graphics-symbolic'];
        let group = null;
        const buttons = new Map();
        ICONS.forEach(name => {
            const button = new Gtk.ToggleButton({css_classes: ['mb-icon-choice', 'flat'], group});
            group ??= button;
            button.set_child(new Gtk.Image({icon_name: name, pixel_size: 18}));
            button.connect('toggled', () => {
                if (button.active)
                    settings.set_string('bar-icon', name);
            });
            buttons.set(name, button);
            grid.append(button);
        });
        const syncIcon = () => (buttons.get(settings.get_string('bar-icon')) ?? group).set_active(true);
        syncIcon();
        settings.connect('changed::bar-icon', () => {
            syncIcon();
            fill();
        });
        iconCard.append(grid);
        return body;
    }

    // --- Monitor ------------------------------------------------------------

    /** Segmented choice bound to a setting; `items` are [value, label]. */
    _choice(settings, key, items) {
        const box = new Gtk.Box({css_classes: ['osmin-seg'], spacing: 2, halign: Gtk.Align.END});
        let first = null;
        const buttons = new Map();
        for (const [value, title] of items) {
            const button = new Gtk.ToggleButton({label: title, group: first});
            first ??= button;
            buttons.set(value, button);
            button.connect('toggled', () => {
                if (!button.active)
                    return;
                if (settings.get_value(key).get_type_string() === 'i')
                    settings.set_int(key, Number(value));
                else
                    settings.set_string(key, String(value));
            });
            box.append(button);
        }
        const sync = () => {
            const current = String(settings.get_value(key).deepUnpack());
            (buttons.get(items.find(([v]) => String(v) === current)?.[0]) ?? first).set_active(true);
        };
        sync();
        settings.connect(`changed::${key}`, sync);
        return box;
    }

    /** A list of ids kept in one setting: a round tick, an icon and a name on each pill. */
    _idsEditor(settings, key, items, grid, columns = 2) {
        const flow = new Gtk.FlowBox({selection_mode: Gtk.SelectionMode.NONE, max_children_per_line: columns, min_children_per_line: columns, homogeneous: true,
            column_spacing: 8, row_spacing: 8, margin_top: 10, margin_bottom: 10, margin_start: 12, margin_end: 12});
        const current = () => new Set(settings.get_strv(key));
        for (const [id, title, icon] of items) {
            const pill = new Gtk.ToggleButton({css_classes: ['mb-pill', 'flat'], active: current().has(id), hexpand: true});
            const line = new Gtk.Box({spacing: 8});
            const tick = new Gtk.Box({css_classes: ['mb-tick'], valign: Gtk.Align.CENTER, halign: Gtk.Align.START, width_request: 16, height_request: 16});
            const mark = new Gtk.Image({icon_name: 'object-select-symbolic', pixel_size: 10, hexpand: true, halign: Gtk.Align.CENTER});
            tick.append(mark);
            line.append(tick);
            line.append(new Gtk.Image({icon_name: icon, pixel_size: 14}));
            line.append(new Gtk.Label({label: title, xalign: 0, hexpand: true}));
            pill.set_child(line);
            const show = () => (mark.visible = pill.active);
            show();
            pill.connect('toggled', () => {
                show();
                const ids = current();
                if (pill.active)
                    ids.add(id);
                else
                    ids.delete(id);
                settings.set_strv(key, items.map(([i]) => i).filter(i => ids.has(i)));
            });
            flow.append(pill);
        }
        grid.attach(flow);
    }

    _monitorPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);

        form.append(new Gtk.Label({label: _('In the top bar'), css_classes: ['s-card-title'], xalign: 0, margin_start: 4}));
        this._idsEditor(settings, 'bar-metrics', [
            ['cpu', _('CPU'), 'utilities-system-monitor-symbolic'],
            ['cputemp', _('CPU temperature'), 'weather-clear-symbolic'],
            ['gpu', _('GPU'), 'video-display-symbolic'],
            ['mem', _('Memory'), 'drive-harddisk-symbolic'],
            ['battery', _('Battery'), 'battery-full-symbolic'],
            ['net', _('Network'), 'network-wireless-symbolic'],
            ['disk', _('Disk usage'), 'drive-harddisk-symbolic'],
            ['diskio', _('Disk activity'), 'drive-harddisk-symbolic'],
            ['power', _('Power draw'), 'ac-adapter-symbolic'],
        ], form);
        form.append(this._dim(_('Choose what is written next to the Osmin icon in the top bar. Nothing chosen: only the icon.')));

        this._rule(form);
        form.append(new Gtk.Label({label: _('In the panel'), css_classes: ['s-card-title'], xalign: 0, margin_start: 4}));
        this._idsEditor(settings, 'system-blocks', [
            ['temps', _('Temperatures'), 'weather-clear-symbolic'],
            ['cpu', _('CPU'), 'utilities-system-monitor-symbolic'],
            ['gpu', _('GPU'), 'video-display-symbolic'],
            ['memory', _('Memory'), 'drive-harddisk-symbolic'],
            ['uptime', _('Uptime'), 'preferences-system-time-symbolic'],
        ], form);
        this._rule(form);
        this._toggleRow(form, settings, 'graph-scale', '', _('Show graph scale'), _('Write the highest value on the dotted line of every graph.'));

        this._rule(form);
        form.append(new Gtk.Label({label: _('Readings and alerts'), css_classes: ['s-card-title'], xalign: 0, margin_start: 4}));
        this._row(form, _('Update every'), this._choice(settings, 'monitor-interval', [[1, _('1 second')], [2, _('2 seconds')], [5, _('5 seconds')]]),
            _('How often the numbers are read while a monitor page or a top-bar value is shown.'));
        this._row(form, _('Temperatures'), this._choice(settings, 'temp-unit', [['C', '°C'], ['F', '°F']]));
        this._rule(form);

        form.append(new Gtk.Label({label: _('Alerts'), css_classes: ['s-card-title'], xalign: 0, margin_start: 4}));
        this._toggleRow(form, settings, 'system-alerts', '', _('Show alerts'), _('A card in the capsule when one of the limits below is passed. 0 turns a limit off.'));
        const limits = [
            ['alert-cpu', _('High CPU'), _('% for 30 seconds'), 0, 100, 5],
            ['alert-temp', _('High CPU temperature'), '°C', 0, 120, 5],
            ['alert-memory', _('Memory nearly full'), _('% free'), 0, 50, 1],
            ['alert-disk', _('Low disk space'), _('% free'), 0, 50, 1],
            ['alert-battery', _('Low battery'), '%', 0, 50, 5],
        ];
        for (const [key, title, unit, lower, upper, step] of limits) {
            const box = new Gtk.Box({spacing: 8, halign: Gtk.Align.END});
            box._inline = true;
            const adjustment = new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5});
            settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
            box.append(new Gtk.SpinButton({adjustment, css_classes: ['osmin-value'], width_chars: 4}));
            box.append(new Gtk.Label({label: unit, css_classes: ['dim']}));
            this._row(form, title, box);
        }
        return body;
    }

    // --- About --------------------------------------------------------------

    _aboutPage() {
        const body = this._body();
        body.halign = Gtk.Align.CENTER;
        body.valign = Gtk.Align.START;
        body.margin_top = 60;
        body.spacing = 8;
        const logo = this._icon('view-grid-symbolic');
        logo.set_size_request(72, 72);
        logo.halign = Gtk.Align.CENTER;
        logo.valign = Gtk.Align.START;
        logo.vexpand = false;
        body.append(logo);
        body.append(new Gtk.Label({label: _('Osmin'), css_classes: ['osmin-page-title']}));
        const version = this._dim(_('Version %s').format(this.metadata['version-name'] ?? ''));
        version.halign = Gtk.Align.CENTER;
        body.append(version);
        body.append(new Gtk.Label({
            label: _('A Dynamic Island for GNOME: media, calendar, mirror, shortcuts and a file tray in one capsule at the top of the screen.'),
            wrap: true,
            max_width_chars: 44,
            justify: Gtk.Justification.CENTER,
            margin_top: 8,
        }));
        const link = new Gtk.LinkButton({uri: this.metadata.url ?? '', label: _('Project page')});
        link.halign = Gtk.Align.CENTER;
        body.append(link);
        return body;
    }

    // --- Gestures -----------------------------------------------------------

    _gesturesPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);

        this._toggleRow(form, settings, 'gestures-swipe-open', _('Capsule'), _('Swipe down to open'),
            _('Two-finger swipe down over the collapsed capsule.'));
        this._toggleRow(form, settings, 'gestures-swipe-close', '', _('Swipe up to close'),
            _('Two-finger swipe up over the open capsule (on its first page).'));
        this._toggleRow(form, settings, 'gestures-invert', '', _('Invert direction'),
            _('Reverses every swipe: up opens, down closes, and so on.'));

        this._rule(form);
        this._toggleRow(form, settings, 'gestures-media-swipe', _('Media'), _('Swipe sideways to skip tracks'),
            _('While music is playing: left is the previous track, right the next one.'));

        const values = ['activity', 'play-pause', 'off'];
        const middle = new Gtk.DropDown({
            model: Gtk.StringList.new([_('Next activity'), _('Play / pause'), _('Nothing')]),
        });
        middle.selected = Math.max(0, values.indexOf(settings.get_string('gestures-middle-click')));
        middle.connect('notify::selected', () =>
            settings.set_string('gestures-middle-click', values[middle.selected]));
        settings.connect('changed::gestures-middle-click', () => {
            middle.selected = Math.max(0, values.indexOf(settings.get_string('gestures-middle-click')));
        });
        this._rule(form);
        this._row(form, _('Middle click'), middle, _('On the collapsed capsule.'));

        this._resetRow(form, settings, ['gestures-swipe-open', 'gestures-swipe-close', 'gestures-media-swipe',
            'gestures-invert', 'gestures-middle-click']);
        return body;
    }

    // --- Tray ---------------------------------------------------------------

    _trayPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);

        this._toggleRow(form, settings, 'tray-keep-files', _('Tray'), _('Keep files'),
            _('Remember the tray after a restart or logout.'));
        this._row(form, '', new Gtk.Box(),
            _('Drag files over the capsule and release them to put them in the tray. ' +
                'The files themselves are never copied or moved.'));

        this._resetRow(form, settings, ['tray-keep-files']);
        return body;
    }

    // --- Clipboard ----------------------------------------------------------

    _clipboardPage(settings) {
        const body = this._body();
        const form = this._form();
        body.append(form);

        this._toggleRow(form, settings, 'clipboard-click-pastes', _('Clipboard'), _('A click pastes'),
            _('Clicking an item puts it in the app you were using (Ctrl+V). Off: it is only copied.'));
        this._rule(form);
        this._toggleRow(form, settings, 'clipboard-clean-urls', _('Links'), _('Remove tracking from copied links'),
            _('utm_*, fbclid, gclid and similar parameters are cut from a link when you copy it.'));
        this._toggleRow(form, settings, 'clipboard-keep-history', _('History'), _('Keep history after a restart'),
            _('Off: only pinned items and your notes are saved on disk, so copied passwords are not.'));
        this._row(form, _('History size'), this._slider(settings, 'clipboard-max-items', [5, 100, 5]),
            _('How many unpinned items are kept.'));
        this._row(form, '', new Gtk.Box(),
            _('Only text is recorded. Items copied from password managers are skipped.'));

        this._resetRow(form, settings, ['clipboard-click-pastes', 'clipboard-keep-history', 'clipboard-max-items', 'clipboard-clean-urls']);
        return body;
    }

    // --- Live Activities ------------------------------------------------------

    _activitiesPage(settings) {
        const body = this._body();

        const strip = this._strip();
        const defs = [
            ['activity-media', _('Music'), _('Playing track'), 'folder-music-symbolic'],
            ['activity-timer', _('Timer'), _('Countdown'), 'alarm-symbolic'],
            ['activity-calendar', _('Calendar'), _('Next meeting'), 'x-office-calendar-symbolic'],
            ['activity-files', _('Tray'), _('Added files'), 'folder-download-symbolic'],
            ['activity-downloads', _('Downloads'), _('Files arriving'), 'folder-download-symbolic'],
        ];
        const rebuild = () => {
            let child;
            while ((child = strip.get_first_child()))
                strip.remove(child);
            for (const [key, title, caption, icon] of defs) {
                const active = settings.get_boolean(key);
                strip.append(this._chip({
                    icon, title, caption, active, selected: false,
                    onToggle: value => {
                        if (value !== settings.get_boolean(key))
                            settings.set_boolean(key, value);
                    },
                }));
            }
        };
        defs.forEach(([key]) => settings.connect(`changed::${key}`, rebuild));
        rebuild();
        body.append(strip);
        body.append(this._dim(_('Choose what gets its own place in the capsule.')));

        const form = this._form();
        body.append(form);
        this._toggleRow(form, settings, 'activities-in-collapsed', _('Collapsed capsule'),
            _('Show activities when collapsed'),
            _('A running timer, music or a meeting instead of the time.'));

        this._rule(form);
        this._row(form, _('Music card'), this._slider(settings, 'peek-media-seconds', [0.5, 10, 0.1], 1),
            _('Seconds the card with the new track stays on screen.'));
        this._row(form, _('Tray card'), this._slider(settings, 'peek-files-seconds', [0.5, 10, 0.1], 1),
            _('Seconds the "Adding / Added files" card stays on screen.'));
        this._row(form, _('Meeting card'), this._slider(settings, 'peek-calendar-seconds', [0.5, 30, 0.5], 1),
            _('Seconds the card about an upcoming meeting stays on screen.'));

        this._rule(form);
        this._row(form, _('Album corner radius'), this._slider(settings, 'album-corner-radius', [0, 24, 1]));

        const effects = [['bars', _('Audio spectrum')], ['waves', _('Waves')]];
        const radios = new Gtk.Box({spacing: 18});
        let first = null;
        for (const [value, title] of effects) {
            const radio = new Gtk.CheckButton({label: title, group: first});
            first ??= radio;
            radio.active = settings.get_string('media-effect') === value;
            radio.connect('toggled', () => {
                if (radio.active)
                    settings.set_string('media-effect', value);
            });
            settings.connect('changed::media-effect', () => {
                radio.active = settings.get_string('media-effect') === value;
            });
            radios.append(radio);
        }
        this._row(form, _('Effect type'), radios, _('The animation shown while music plays.'));
        this._toggleRow(form, settings, 'show-lyrics', '', _('Show lyrics'),
            _('The line being sung appears under the title. The artist, title, album and length of the song are sent to lrclib.net to find the lyrics; nothing else.'));
        this._toggleRow(form, settings, 'colored-effects', '', _('Colored effects'),
            _('The effect takes the color of the album art; otherwise it is white.'));

        this._resetRow(form, settings, ['activities-in-collapsed', 'album-corner-radius', 'media-effect',
            'colored-effects', 'show-lyrics', 'activity-media',
            'activity-timer', 'activity-calendar', 'activity-files', 'activity-downloads',
            'peek-media-seconds', 'peek-files-seconds', 'peek-calendar-seconds']);
        return body;
    }
}

Object.assign(OsminPreferences.prototype, utilityMethods);
