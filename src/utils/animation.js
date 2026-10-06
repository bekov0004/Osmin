import Clutter from 'gi://Clutter';
import St from 'gi://St';

/** Zero when the user turned animations off in GNOME settings. */
export function animDuration(ms) {
    return St.Settings.get().enable_animations ? ms : 0;
}

export function fadeIn(actor, {duration = 220, delay = 0} = {}) {
    actor.remove_all_transitions();
    actor.show();
    actor.ease({
        opacity: 255,
        duration: animDuration(duration),
        delay: animDuration(delay),
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
}

export function fadeOut(actor, {duration = 120} = {}) {
    actor.remove_all_transitions();
    actor.ease({
        opacity: 0,
        duration: animDuration(duration),
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onComplete: () => actor.hide(),
    });
}
