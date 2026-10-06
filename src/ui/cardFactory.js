import {EventType} from '../utils/events.js';
import {ActivityCard} from './activityCard.js';
import {NotificationCard} from './notificationCard.js';

// One card class per event type. Types without a card class use NotificationCard.
const CARD_CLASSES = new Map([
    [EventType.NOTIFICATION, NotificationCard],
    [EventType.ACTIVITY, ActivityCard],
]);

export function cardClassFor(card) {
    return CARD_CLASSES.get(card.type) ?? NotificationCard;
}

export function createCard(card) {
    return new (cardClassFor(card))(card);
}
