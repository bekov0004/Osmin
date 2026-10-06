import Clutter from 'gi://Clutter';

export const State = Object.freeze({
    CLOSED: 'closed',
    HOVER: 'hover',
    OPEN: 'open',
    CARD: 'card',
});

// Sizes are in CSS pixels (they are multiplied by the shell UI scale factor
// with `scaled()`); the open width also adapts to the monitor.
export const Layout = Object.freeze({
    // Collapsed capsule: as wide as its content, but at least this.
    CLOSED_MIN_WIDTH: 88,
    CLOSED_PADDING: 30,
    // Vertical gap between the capsule and the top-bar edges.
    PANEL_INSET: 3,
    // How much the capsule swells on hover, before it opens.
    HOVER_GROW: 14,
    // Expanded capsule: a share of the monitor width, clamped.
    OPEN_WIDTH_RATIO: 0.38,
    OPEN_MIN_WIDTH: 660,
    OPEN_MAX_WIDTH: 820,
    // Widgets shown side by side on one page of the expanded capsule.
    COLUMNS: 3,
    SCREEN_MARGIN: 24,
    OPEN_MAX_HEIGHT_RATIO: 0.5,
});

// Duration (ms) and easing used when the capsule morphs INTO a state.
export const Motion = Object.freeze({
    [State.CLOSED]: {duration: 260, mode: Clutter.AnimationMode.EASE_OUT_CUBIC},
    [State.HOVER]: {duration: 170, mode: Clutter.AnimationMode.EASE_OUT_BACK},
    [State.OPEN]: {duration: 340, mode: Clutter.AnimationMode.EASE_OUT_QUINT},
    [State.CARD]: {duration: 320, mode: Clutter.AnimationMode.EASE_OUT_BACK},
});

export const HOVER_INTENT_MS = 50;    // pointer must rest this long before the capsule reacts
export const OPEN_DWELL_MS = 150;     // ...and this long more before it opens
export const HOVER_LEAVE_MS = 80;     // pointer left a hovering capsule
export const OPEN_LEAVE_MS = 300;     // pointer left the open capsule
export const INTERACTION_GRACE_MS = 1400; // extra time after the user clicked inside

// Temporary "Test events" strip in the open capsule; set to false to hide it.
export const SHOW_DEBUG_ACTIONS = false;
