/**
 * The touchpad gestures Osmin understands and what can be given to them. Pure data: the settings window and the shell
 * both read it (the shell knows how to do each action, see gestureActions.js).
 *
 * A gesture is "swipe3-left" (three fingers move left), "swipe4-up", "pinch3-in" (three fingers come together),
 * "pinch4-out", "hold3" (three fingers rest on the touchpad and lift without moving) ...
 * Two fingers are left to the apps (scrolling, zoom), as GNOME does.
 */
export const FINGERS = [3, 4];
export const DIRECTIONS = ['left', 'right', 'up', 'down'];

export const GESTURES = [
    ...FINGERS.flatMap(n => DIRECTIONS.map(d => ({id: `swipe${n}-${d}`, kind: 'swipe', fingers: n, direction: d}))),
    ...FINGERS.flatMap(n => ['in', 'out'].map(d => ({id: `pinch${n}-${d}`, kind: 'pinch', fingers: n, direction: d}))),
    ...FINGERS.map(n => ({id: `hold${n}`, kind: 'hold', fingers: n, direction: null})),
];

/**
 * What a gesture can do. kind: 'live' follows the fingers while they move (the app switcher, GNOME's own workspaces and
 * overview), 'once' happens once when the gesture is clear. `keys` is pressed as a keyboard shortcut.
 */
export const ACTIONS = [
    {id: 'none', group: '', title: 'Nothing', kind: 'once'},

    {id: 'app-switcher', group: 'Apps and windows', title: 'Switch apps (like Alt+Tab)', kind: 'live'},
    {id: 'window-switcher', group: 'Apps and windows', title: 'Switch windows', kind: 'live'},
    {id: 'previous-app', group: 'Apps and windows', title: 'Back to the previous app', kind: 'once'},
    {id: 'show-desktop', group: 'Apps and windows', title: 'Show the desktop', kind: 'once'},
    {id: 'window-maximize', group: 'Apps and windows', title: 'Maximize or restore the window', kind: 'once'},
    {id: 'window-minimize', group: 'Apps and windows', title: 'Minimize the window', kind: 'once'},
    {id: 'window-fullscreen', group: 'Apps and windows', title: 'Full screen on or off', kind: 'once'},
    {id: 'window-close', group: 'Apps and windows', title: 'Close the window', kind: 'once'},
    {id: 'tile-left', group: 'Apps and windows', title: 'Window to the left half', kind: 'once', keys: '<Super>Left'},
    {id: 'tile-right', group: 'Apps and windows', title: 'Window to the right half', kind: 'once', keys: '<Super>Right'},

    {id: 'workspaces', group: 'GNOME', title: 'Workspaces (follows the fingers)', kind: 'live'},
    {id: 'overview', group: 'GNOME', title: 'Overview and apps (follows the fingers)', kind: 'live'},
    {id: 'workspace-left', group: 'GNOME', title: 'Workspace on the left', kind: 'once'},
    {id: 'workspace-right', group: 'GNOME', title: 'Workspace on the right', kind: 'once'},
    {id: 'overview-toggle', group: 'GNOME', title: 'Overview', kind: 'once'},
    {id: 'app-grid', group: 'GNOME', title: 'All apps', kind: 'once'},
    {id: 'notifications', group: 'GNOME', title: 'Notifications and calendar', kind: 'once'},
    {id: 'quick-settings', group: 'GNOME', title: 'Quick settings', kind: 'once'},
    {id: 'screenshot-ui', group: 'GNOME', title: 'Screenshot (GNOME)', kind: 'once', keys: 'Print'},
    {id: 'lock', group: 'GNOME', title: 'Lock the screen', kind: 'once'},

    {id: 'volume-up', group: 'Sound and light', title: 'Volume up', kind: 'once', keys: 'XF86AudioRaiseVolume'},
    {id: 'volume-down', group: 'Sound and light', title: 'Volume down', kind: 'once', keys: 'XF86AudioLowerVolume'},
    {id: 'volume-mute', group: 'Sound and light', title: 'Mute or unmute', kind: 'once', keys: 'XF86AudioMute'},
    {id: 'brightness-up', group: 'Sound and light', title: 'Brighter screen', kind: 'once', keys: 'XF86MonBrightnessUp'},
    {id: 'brightness-down', group: 'Sound and light', title: 'Darker screen', kind: 'once', keys: 'XF86MonBrightnessDown'},
    {id: 'play-pause', group: 'Sound and light', title: 'Play or pause', kind: 'once'},
    {id: 'next', group: 'Sound and light', title: 'Next track', kind: 'once'},
    {id: 'prev', group: 'Sound and light', title: 'Previous track', kind: 'once'},

    {id: 'back', group: 'Browser and documents', title: 'Back', kind: 'once', keys: '<Alt>Left'},
    {id: 'forward', group: 'Browser and documents', title: 'Forward', kind: 'once', keys: '<Alt>Right'},
    {id: 'tab-next', group: 'Browser and documents', title: 'Next tab', kind: 'once', keys: '<Control>Page_Down'},
    {id: 'tab-prev', group: 'Browser and documents', title: 'Previous tab', kind: 'once', keys: '<Control>Page_Up'},
    {id: 'tab-new', group: 'Browser and documents', title: 'New tab', kind: 'once', keys: '<Control>t'},
    {id: 'tab-close', group: 'Browser and documents', title: 'Close the tab', kind: 'once', keys: '<Control>w'},
    {id: 'tab-reopen', group: 'Browser and documents', title: 'Reopen the closed tab', kind: 'once', keys: '<Control><Shift>t'},
    {id: 'reload', group: 'Browser and documents', title: 'Reload', kind: 'once', keys: 'F5'},
    {id: 'zoom-in', group: 'Browser and documents', title: 'Zoom in', kind: 'once', keys: '<Control>plus'},
    {id: 'zoom-out', group: 'Browser and documents', title: 'Zoom out', kind: 'once', keys: '<Control>minus'},
    {id: 'copy', group: 'Browser and documents', title: 'Copy', kind: 'once', keys: '<Control>c'},
    {id: 'paste', group: 'Browser and documents', title: 'Paste', kind: 'once', keys: '<Control>v'},
    {id: 'undo', group: 'Browser and documents', title: 'Undo', kind: 'once', keys: '<Control>z'},

    {id: 'osmin:osmin', group: 'Osmin', title: 'Open Osmin', kind: 'once'},
    {id: 'osmin:tray', group: 'Osmin', title: 'Tray', kind: 'once'},
    {id: 'osmin:clipboard', group: 'Osmin', title: 'Clipboard history', kind: 'once'},
    {id: 'osmin:notifications', group: 'Osmin', title: 'Alerts', kind: 'once'},
    {id: 'osmin:command', group: 'Osmin', title: 'Search (command bar)', kind: 'once'},
    {id: 'osmin:quickpanel', group: 'Osmin', title: 'Quick panel', kind: 'once'},
    {id: 'osmin:radial', group: 'Osmin', title: 'Radial menu', kind: 'once'},
    {id: 'osmin:screenshot', group: 'Osmin', title: 'Screenshot (Osmin)', kind: 'once'},
    {id: 'osmin:color', group: 'Osmin', title: 'Colour picker', kind: 'once'},
    {id: 'osmin:mic', group: 'Osmin', title: 'Microphone on or off', kind: 'once'},
    {id: 'osmin:awake', group: 'Osmin', title: 'Keep awake', kind: 'once'},
    {id: 'osmin:output', group: 'Osmin', title: 'Next sound output', kind: 'once'},

    {id: 'keys', group: 'Other', title: 'Press keys…', kind: 'once'},
];

/** What GNOME itself does (also what "Reset" gives back), plus three-finger app switching. */
export const DEFAULT_GESTURES = {
    'swipe3-left': 'app-switcher', 'swipe3-right': 'app-switcher', 'swipe3-up': 'overview', 'swipe3-down': 'overview',
    'swipe4-left': 'workspaces', 'swipe4-right': 'workspaces', 'swipe4-up': 'overview', 'swipe4-down': 'overview',
};

/** "keys:<Control>w" is an action of its own: these keys are pressed. */
export function actionOf(value) {
    if (value?.startsWith('keys:'))
        return {...ACTIONS.find(a => a.id === 'keys'), keys: value.slice(5)};
    return ACTIONS.find(a => a.id === value) ?? ACTIONS[0];
}

/** The action of every gesture: the saved choices over the defaults. */
export function gestureMap(saved) {
    const map = {};
    for (const gesture of GESTURES)
        map[gesture.id] = saved?.[gesture.id] ?? DEFAULT_GESTURES[gesture.id] ?? 'none';
    return map;
}
