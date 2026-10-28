import {CalendarWidget} from './calendar/calendarWidget.js';
import {FocusWidget} from './focus/focusWidget.js';
import {MediaWidget} from './media/mediaWidget.js';
import {NotesWidget} from './notes/notesWidget.js';
import {MirrorWidget} from './mirror/mirrorWidget.js';
import {ShortcutsWidget} from './shortcuts/shortcutsWidget.js';
import {SoundWidget} from './sound/soundWidget.js';
import {SystemWidget} from './system/systemWidget.js';
import {TimerWidget} from './timer/timerWidget.js';
import {ToolsWidget} from './tools/toolsWidget.js';
import {TodoWidget} from './todo/todoWidget.js';

/** All widgets by id. The user chooses which ones to show and in what order. */
export const WIDGET_CLASSES = [
    MediaWidget,
    CalendarWidget,
    MirrorWidget,
    TimerWidget,
    TodoWidget,
    NotesWidget,
    ShortcutsWidget,
    ToolsWidget,
    FocusWidget,
    SystemWidget,
    SoundWidget,
];
