import {CalendarWidget} from './calendar/calendarWidget.js';
import {MediaWidget} from './media/mediaWidget.js';
import {MirrorWidget} from './mirror/mirrorWidget.js';
import {ShortcutsWidget} from './shortcuts/shortcutsWidget.js';
import {TimerWidget} from './timer/timerWidget.js';
import {TodoWidget} from './todo/todoWidget.js';

/** All widgets by id. The user chooses which ones to show and in what order. */
export const WIDGET_CLASSES = [
    MediaWidget,
    CalendarWidget,
    MirrorWidget,
    TimerWidget,
    TodoWidget,
    ShortcutsWidget,
];
