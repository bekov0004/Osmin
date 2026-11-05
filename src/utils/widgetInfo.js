// The widgets Osmin offers for the main row, in their default order, with their
// default width in cells. Plain data (no shell imports) so the preferences
// window, which runs in a separate process, can use it too. (The file tray is
// not a widget: it is the second mode of the capsule.)
export const WIDGET_INFO = Object.freeze([
    {id: 'media', title: 'Media Player', subtitle: 'The music or video playing in any player', cells: 5, minCells: 3},
    {id: 'calendar', title: 'Calendar', subtitle: 'The days around today and the events', cells: 4, minCells: 3},
    {id: 'mirror', title: 'Mirror', subtitle: 'A webcam preview, only while open', cells: 3, minCells: 2},
    {id: 'timer', title: 'Timer', subtitle: 'A countdown that shows in the capsule', cells: 3, minCells: 3},
    {id: 'focus', title: 'Focus', subtitle: 'A Pomodoro focus timer and a stopwatch with laps', cells: 3, minCells: 3, menu: true},
    {id: 'system', title: 'System', subtitle: 'Processor, memory, temperature, network, disk and battery, with alerts', cells: 4, minCells: 4, menu: true},
    {id: 'sound', title: 'Sound', subtitle: 'Volume, output, microphone mute and the volume of each application', cells: 4, minCells: 4, menu: true},
    {id: 'downloads', title: 'Downloads', subtitle: 'Files arriving in the Downloads folder, with progress in the capsule', cells: 4, minCells: 3, menu: true},
    {id: 'input', title: 'Input', subtitle: 'Mouse and keyboard switches: scrolling, acceleration, tap to click, focus follows mouse', cells: 4, minCells: 4, menu: true},
    {id: 'windows', title: 'Windows', subtitle: 'Live previews of the open windows, and snap, centre, maximize, move to the next monitor', cells: 5, minCells: 4, menu: true},
    {id: 'agents', title: 'AI Agents', subtitle: 'Claude Code and Codex: working now, tokens of the last 5 hours and week, a card when a task is done', cells: 4, minCells: 4, menu: true},
    {id: 'companion', title: 'Companion', subtitle: 'A small friend: its eyes follow the pointer, it sways to the music, gets surprised by cards and falls asleep', cells: 2, minCells: 2},
    {id: 'shortcuts', title: 'Shortcuts', subtitle: 'Launch your favourite apps', cells: 4, minCells: 2},
    {id: 'todo', title: 'To-do', subtitle: 'A simple local task list', cells: 4, minCells: 3},
    {id: 'notes', title: 'Notes', subtitle: 'Quick notes you can copy later', cells: 4, minCells: 3},
    {id: 'tools', title: 'Quick Toggles', subtitle: 'Keep awake, dark mode, screenshot, colour picker, cleaning mode', cells: 5, minCells: 4, menu: true},
]);

export const DEFAULT_WIDGETS = Object.freeze(['media', 'calendar', 'mirror', 'windows', 'tools', 'focus', 'system', 'sound', 'input', 'downloads']);

/** Widgets with `menu: true` live in the pages of the top-bar button's window; the others in the capsule. */
export const MENU_WIDGET_IDS = Object.freeze(WIDGET_INFO.filter(w => w.menu).map(w => w.id));

export const BASE_CELL_CSS = 44; // px of one cell at size scale 1
