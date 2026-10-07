// The widgets Osmin offers for the main row, in their default order, with their
// default width in cells. Plain data (no shell imports) so the preferences
// window, which runs in a separate process, can use it too. (The file tray is
// not a widget: it is the second mode of the capsule.)
export const WIDGET_INFO = Object.freeze([
    {id: 'media', title: 'Media Player', subtitle: 'The music or video playing in any player', cells: 5, minCells: 3},
    {id: 'calendar', title: 'Calendar', subtitle: 'The days around today and the events', cells: 4, minCells: 3},
    {id: 'mirror', title: 'Mirror', subtitle: 'A webcam preview, only while open', cells: 3, minCells: 2},
    {id: 'timer', title: 'Timer', subtitle: 'A countdown that shows in the capsule', cells: 3, minCells: 3},
    {id: 'shortcuts', title: 'Shortcuts', subtitle: 'Launch your favourite apps', cells: 4, minCells: 2},
    {id: 'todo', title: 'To-do', subtitle: 'A simple local task list', cells: 4, minCells: 3},
    {id: 'notes', title: 'Notes', subtitle: 'Quick notes you can copy later', cells: 4, minCells: 3},
]);

export const DEFAULT_WIDGETS = Object.freeze(['media', 'calendar', 'mirror']);

export const BASE_CELL_CSS = 44; // px of one cell at size scale 1
