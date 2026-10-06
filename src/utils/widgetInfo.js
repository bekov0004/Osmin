// The widgets Osmin offers, in display order. Plain data (no shell imports) so
// the preferences window, which runs in a separate process, can use it too.
export const WIDGET_INFO = Object.freeze([
    {id: 'media', title: 'Media', subtitle: 'The music or video playing in any player'},
    {id: 'calendar', title: 'Calendar', subtitle: 'Month view and upcoming events'},
    {id: 'files', title: 'Files', subtitle: 'A shelf for files dropped on the capsule'},
    {id: 'timer', title: 'Timer', subtitle: 'A countdown that shows in the capsule'},
    {id: 'todo', title: 'To-do', subtitle: 'A simple local task list'},
    {id: 'mirror', title: 'Mirror', subtitle: 'A webcam preview, only while open'},
]);
