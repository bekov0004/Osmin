import Clutter from 'gi://Clutter';

export const State = Object.freeze({
    CLOSED: 'closed',
    HOVER: 'hover',
    OPEN: 'open',
    CARD: 'card',
    DROP: 'drop',
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
    SCREEN_MARGIN: 24,
    OPEN_MAX_HEIGHT_RATIO: 0.5,
    // The fillet where the expanded capsule meets the top bar.
    EAR_RADIUS: 18,
    // The area that wakes the capsule up when files are dragged near it.
    DROP_HOT_HALF_WIDTH: 260,
    DROP_HOT_HEIGHT: 150,
    DROP_ARM_MARGIN: 20,
    // The pointer counts as "near" the collapsed capsule this far from it.
    APPROACH_MARGIN: 12,
});

// Duration (ms) and easing used when the capsule morphs INTO a state.
export const Motion = Object.freeze({
    [State.CLOSED]: {duration: 260, mode: Clutter.AnimationMode.EASE_OUT_CUBIC},
    [State.HOVER]: {duration: 170, mode: Clutter.AnimationMode.EASE_OUT_BACK},
    [State.OPEN]: {duration: 340, mode: Clutter.AnimationMode.EASE_OUT_QUINT},
    [State.CARD]: {duration: 320, mode: Clutter.AnimationMode.EASE_OUT_BACK},
    [State.DROP]: {duration: 340, mode: Clutter.AnimationMode.EASE_OUT_QUINT},
});

// Scrolling over the capsule: a gesture needs this much smooth-scroll distance
// (about one wheel notch) and then ignores further scrolling for a moment, so
// touchpad momentum does not skip several pages.
export const SCROLL_THRESHOLD = 1.0;
export const SCROLL_LOCK_MS = 380;

export const HOVER_INTENT_MS = 50;    // pointer must rest this long before the capsule reacts
export const OPEN_DWELL_MS = 150;     // ...and this long more before it opens
export const HOVER_LEAVE_MS = 80;     // pointer left a hovering capsule
export const OPEN_LEAVE_MS = 300;     // pointer left the open capsule
export const INTERACTION_GRACE_MS = 1400; // extra time after the user clicked inside

// Temporary "Test events" strip in the open capsule; set to false to hide it.
export const SHOW_DEBUG_ACTIONS = false;
