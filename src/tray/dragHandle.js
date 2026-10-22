import Clutter from 'gi://Clutter';

/** What a drag of text carries: the drag-out helper recognises this prefix and offers plain text. */
export const TEXT_PAYLOAD_PREFIX = 'osmin-text:';

/** The drag-out payload for a piece of text. */
export const textPayload = text => [`${TEXT_PAYLOAD_PREFIX}${text}`];

/**
 * Makes an actor a handle for dragging its content out into other applications (see
 * DragOutService): the helper is made ready while the pointer rests on it, and a press followed by
 * a move of more than a few px starts the drag.
 * @param {Clutter.Actor} actor a hover-tracking actor
 * @param {{payload: string[], drag: object, isAction?: (event) => boolean}} params
 *   payload: file:// URIs or textPayload(); isAction: whether a press landed on a small button on the actor
 */
export function makeDraggable(actor, {payload, drag, isAction = () => false}) {
    actor.connect('destroy', () => drag.disarm?.());
    // As soon as the list is on screen, start the helper (it takes a while to come up).
    actor.connect('notify::mapped', () => {
        if (actor.mapped)
            drag.warm?.();
    });
    let origin = null;
    let started = false;
    actor.connect('captured-event', (_actor, event) => {
        switch (event.type()) {
        case Clutter.EventType.BUTTON_PRESS:
            if (event.get_button() === Clutter.BUTTON_PRIMARY && !isAction(event)) {
                origin = event.get_coords();
                started = false;
                drag.prepare(payload);
            }
            break;
        case Clutter.EventType.MOTION:
            // The pointer is on this item: keep the drag-out helper waiting under it.
            if (!origin)
                drag.arm(payload, () => actor.hover);
            if (origin && !started) {
                const [x, y] = event.get_coords();
                if (Math.hypot(x - origin[0], y - origin[1]) > 10) {
                    started = true;
                    drag.begin();
                }
            }
            break;
        case Clutter.EventType.BUTTON_RELEASE:
            if (origin && !started)
                drag.cancel();
            origin = null;
            break;
        }
        return Clutter.EVENT_PROPAGATE;
    });
    actor.connect('notify::hover', () => {
        // The pointer rests on the item: get the drag-out helper ready, under the pointer.
        if (actor.hover)
            drag.arm?.(payload, () => actor.hover);
        else
            drag.disarm?.();
    });
}
