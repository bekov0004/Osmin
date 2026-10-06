import Clutter from 'gi://Clutter';

// Logical pixel sizes at scale-factor 1. Multiply with `scaled()` before use.
export const State = Object.freeze({
    CLOSED: 'closed',
    HOVER: 'hover',
    OPEN: 'open',
    NOTIFY: 'notify',
});

export const Preset = Object.freeze({
    [State.CLOSED]: {
        width: 64,
        height: 20,
        duration: 340,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
    },
    [State.HOVER]: {
        width: 176,
        height: 36,
        duration: 380,
        mode: Clutter.AnimationMode.EASE_OUT_BACK,
    },
    [State.OPEN]: {
        width: 388,
        height: 204,
        duration: 520,
        mode: Clutter.AnimationMode.EASE_OUT_BACK,
    },
    [State.NOTIFY]: {
        width: 292,
        height: 56,
        duration: 460,
        mode: Clutter.AnimationMode.EASE_OUT_BACK,
    },
});

// Gap between the bottom of the top bar and the island.
export const TOP_GAP = 6;

export const HOVER_INTENT_MS = 70;
export const HOVER_LEAVE_MS = 160;
export const OPEN_LEAVE_MS = 1500;
export const NOTIFY_MS = 3000;
