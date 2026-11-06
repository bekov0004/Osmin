import {CalendarWidget} from './calendar/calendarWidget.js';
import {FocusWidget} from './focus/focusWidget.js';
import {MediaWidget} from './media/mediaWidget.js';
import {NotesWidget} from './notes/notesWidget.js';
import {MirrorWidget} from './mirror/mirrorWidget.js';
import {ShortcutsWidget} from './shortcuts/shortcutsWidget.js';
import {CompanionWidget} from './companion/companionWidget.js';
import {AgentsWidget} from './agents/agentsWidget.js';
import {WindowsWidget} from './windows/windowsWidget.js';
import {WorkspacesWidget} from './workspaces/workspacesWidget.js';
import {InputWidget} from './input/inputWidget.js';
import {DownloadsWidget} from './downloads/downloadsWidget.js';
import {SoundWidget} from './sound/soundWidget.js';
import {NetworkWidget} from './network/networkWidget.js';
import {DisksWidget} from './disks/disksWidget.js';
import {PowerWidget} from './power/powerWidget.js';
import {SystemWidget} from './system/systemWidget.js';
import {TimerWidget} from './timer/timerWidget.js';
import {AwakeWidget} from './awake/awakeWidget.js';
import {ControlsWidget} from './controls/controlsWidget.js';
import {DisplaysWidget} from './displays/displaysWidget.js';
import {TogglesWidget} from './toggles/togglesWidget.js';
import {UtilitiesWidget} from './utilities/utilitiesWidget.js';
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
    AwakeWidget,
    DisplaysWidget,
    UtilitiesWidget,
    ControlsWidget,
    TogglesWidget,
    FocusWidget,
    SystemWidget,
    NetworkWidget,
    DisksWidget,
    PowerWidget,
    SoundWidget,
    DownloadsWidget,
    InputWidget,
    WindowsWidget,
    WorkspacesWidget,
    AgentsWidget,
    CompanionWidget,
];
