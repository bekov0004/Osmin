import {EventType} from '../utils/events.js';
import {NotificationCard} from './notificationCard.js';

// One card class per event type. Later stages register MediaCard,
// DownloadCard, ... here; unknown types fall back to NotificationCard.
const CARD_CLASSES = new Map([
    [EventType.NOTIFICATION, NotificationCard],
]);

export function cardClassFor(card) {
    return CARD_CLASSES.get(card.type) ?? NotificationCard;
}

export function createCard(card) {
    return new (cardClassFor(card))(card);
}
