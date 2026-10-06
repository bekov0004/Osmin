import Clutter from 'gi://Clutter';
import St from 'gi://St';

let speed = 1;

/** The user's animation speed setting: 2 makes every animation twice as fast. */
export function setAnimationSpeed(value) {
    speed = Number.isFinite(value) && value > 0 ? value : 1;
}

/** Zero when the user turned animations off in GNOME settings. */
export function animDuration(ms) {
    return St.Settings.get().enable_animations ? Math.round(ms / speed) : 0;
}

/** Fades `actor` in. `onComplete` runs only if the fade was not interrupted. */
export function fadeIn(actor, {duration = 220, delay = 0, onComplete} = {}) {
    actor.remove_all_transitions();
    actor.show();
    actor.ease({
        opacity: 255,
        duration: animDuration(duration),
        delay: animDuration(delay),
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete,
    });
}

/** Fades `actor` out; hides it afterwards unless `hide` is false. */
export function fadeOut(actor, {duration = 120, hide = true, onComplete} = {}) {
    actor.remove_all_transitions();
    actor.ease({
        opacity: 0,
        duration: animDuration(duration),
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => {
            if (hide)
                actor.hide();
            onComplete?.();
        },
    });
}
