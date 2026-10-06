import {EventType, Priority} from '../utils/events.js';

/**
 * Temporary buttons for the open panel that feed the event pipeline.
 * Hide them with SHOW_DEBUG_ACTIONS = false in utils/constants.js.
 */
export function createTestActions(events) {
    let persistentClicks = 0;
    let batch = 0;

    return [
        {
            label: 'Test notification',
            onClick: () => events.emit({
                type: EventType.NOTIFICATION,
                title: 'Test notification',
                icon: 'object-select-symbolic',
            }),
        },
        {
            label: 'Test high priority',
            onClick: () => events.emit({
                type: EventType.NOTIFICATION,
                title: 'High priority',
                description: 'Shown before anything queued',
                icon: 'dialog-warning-symbolic',
                priority: Priority.HIGH,
            }),
        },
        {
            label: 'Test persistent',
            // Same id on every click: the card is updated in place.
            onClick: () => events.emit({
                id: 'test-persistent',
                type: EventType.CUSTOM,
                title: 'Persistent card',
                description: `Click to dismiss · sent ${++persistentClicks}×`,
                persistent: true,
            }),
        },
        {
            label: 'Test multiple events',
            onClick: () => {
                batch++;
                for (const [i, name] of ['A', 'B', 'C'].entries()) {
                    events.emit({
                        id: `test-multi-${batch}-${name}`,
                        type: EventType.NOTIFICATION,
                        title: `Notification ${name}`,
                        description: `Queued ${i + 1} of 3`,
                    });
                }
            },
        },
    ];
}
