// Shared vocabulary of the event -> card pipeline. An event is the raw input
// (`message` is accepted as an alias of `description`); `normalizeEvent()`
// turns it into the card model that CardManager and the card widgets consume.

export const EventType = Object.freeze({
    NOTIFICATION: 'notification',
    MEDIA: 'media',
    DOWNLOAD: 'download',
    BATTERY: 'battery',
    BLUETOOTH: 'bluetooth',
    NETWORK: 'network',
    USB: 'usb',
    WORKSPACE: 'workspace',
    CLIPBOARD: 'clipboard',
    CUSTOM: 'custom',
});

export const Priority = Object.freeze({
    LOW: 'low',
    NORMAL: 'normal',
    HIGH: 'high',
    CRITICAL: 'critical',
});

const RANK = {
    [Priority.LOW]: 0,
    [Priority.NORMAL]: 1,
    [Priority.HIGH]: 2,
    [Priority.CRITICAL]: 3,
};

export function priorityRank(priority) {
    return RANK[priority] ?? RANK[Priority.NORMAL];
}

/** Auto-hide delay in ms by priority; 0 means "stay until dismissed". */
export const DEFAULT_DURATION = Object.freeze({
    [Priority.LOW]: 2500,
    [Priority.NORMAL]: 3500,
    [Priority.HIGH]: 5000,
    [Priority.CRITICAL]: 0,
});

export const MIN_DURATION = 1200;

export const TYPE_ICONS = Object.freeze({
    [EventType.NOTIFICATION]: 'dialog-information-symbolic',
    [EventType.MEDIA]: 'audio-x-generic-symbolic',
    [EventType.DOWNLOAD]: 'folder-download-symbolic',
    [EventType.BATTERY]: 'battery-level-50-symbolic',
    [EventType.BLUETOOTH]: 'bluetooth-active-symbolic',
    [EventType.NETWORK]: 'network-wireless-symbolic',
    [EventType.USB]: 'drive-removable-media-symbolic',
    [EventType.WORKSPACE]: 'view-grid-symbolic',
    [EventType.CLIPBOARD]: 'edit-paste-symbolic',
    [EventType.CUSTOM]: 'dialog-information-symbolic',
});

const TYPES = new Set(Object.values(EventType));
const PRIORITIES = new Set(Object.values(Priority));

let sequence = 0;

/**
 * @param {object} raw  event or card-like object
 * @returns {object|null} card model, or null when there is nothing to show
 */
export function normalizeEvent(raw) {
    if (!raw || typeof raw !== 'object')
        return null;

    let type = raw.type;
    if (!TYPES.has(type)) {
        if (type !== undefined)
            console.warn(`[osmin] unknown event type "${type}", using "custom"`);
        type = EventType.CUSTOM;
    }

    const priority = PRIORITIES.has(raw.priority) ? raw.priority : Priority.NORMAL;

    let title = String(raw.title ?? '').trim();
    let description = String(raw.description ?? raw.message ?? '').trim();
    if (!title) {
        title = description;
        description = '';
    }
    if (!title)
        return null;

    // Critical cards never auto-hide.
    const persistent = raw.persistent === true || priority === Priority.CRITICAL;
    let duration = 0;
    if (!persistent) {
        duration = Number.isFinite(raw.duration) && raw.duration > 0
            ? Math.max(raw.duration, MIN_DURATION)
            : DEFAULT_DURATION[priority];
    }

    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : `${type}-${++sequence}`,
        type,
        title,
        description,
        icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : TYPE_ICONS[type],
        priority,
        duration,
        persistent,
        data: raw.data ?? null,
    };
}
