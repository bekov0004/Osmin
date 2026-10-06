import {CalendarWidget} from './calendar/calendarWidget.js';
import {FilesWidget} from './files/filesWidget.js';
import {MediaWidget} from './media/mediaWidget.js';
import {MirrorWidget} from './mirror/mirrorWidget.js';
import {TimerWidget} from './timer/timerWidget.js';
import {TodoWidget} from './todo/todoWidget.js';

/** All widgets, in display order. Three fit on one page of the expanded capsule. */
export const WIDGET_CLASSES = [
    MediaWidget,
    CalendarWidget,
    FilesWidget,
    TimerWidget,
    TodoWidget,
    MirrorWidget,
];
