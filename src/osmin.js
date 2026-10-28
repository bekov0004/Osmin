import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';

import {CameraState} from './services/cameraService.js';
import {LocalSendSession} from './localsend/localSendSession.js';
import {LocalSendView} from './localsend/localSendView.js';
import {LocalSendReceiveActivity} from './localsend/localSendReceiveActivity.js';
import {CardManager} from './services/cardManager.js';
import {ClockService} from './services/clockService.js';
import {DragService} from './services/dragService.js';
import {NotificationsView} from './notifications/notificationsView.js';
import {ClipboardView} from './clipboard/clipboardView.js';
import {CommandView} from './commandbar/commandView.js';
import {DragOutService} from './tray/dragOut.js';
import {TrayController} from './tray/trayController.js';
import {ClosedView} from './ui/closedView.js';
import {Ear} from './ui/ear.js';
import {computeLayout} from './ui/osminLayout.js';
import {OsminPanel, PanelMode} from './ui/osminPanel.js';
import {cardClassFor, createCard} from './ui/cardFactory.js';
import {WIDGET_CLASSES} from './widgets/registry.js';
import {animDuration, fadeIn, fadeOut, setAnimationSpeed} from './utils/animation.js';
import {
    HOVER_INTENT_MS, HOVER_LEAVE_MS, INTERACTION_GRACE_MS, Layout, Motion, OPEN_DWELL_MS,
    OPEN_LEAVE_MS, SCROLL_LOCK_MS, SCROLL_THRESHOLD, State,
} from './utils/constants.js';
import {EventType, Priority} from './utils/events.js';
import {getScaleFactor, scaled} from './utils/scale.js';
import {listOverflow} from './ui/overflow.js';
import {SignalTracker} from './utils/signals.js';
import {Timers} from './utils/timers.js';

// Resizing between two cards, or after a card update: calm, no overshoot.
// How far a card's content reaches up into the band of the top bar, so the card
// hangs only a little below the bar instead of stacking under it.
const CARD_OVERLAP = 24;

const RESIZE = {duration: 220, mode: Clutter.AnimationMode.EASE_OUT_CUBIC};

// States in which the capsule hangs from the top edge (the rest sit inside the bar).
// Every state hangs from the top edge of the screen, collapsed (the notch) or expanded.
const HANGING = new Set([State.CLOSED, State.HOVER, State.OPEN, State.CARD, State.DROP]);
const COLLAPSED = new Set([State.CLOSED, State.HOVER]);
// States that show the panel (widgets / tray).
const PANEL_STATES = new Set([State.OPEN, State.DROP]);

// Touchpad scroll units (a short swipe is a few of them) to pixels of extra height.
const PULL_GAP_MS = 250;      // a pause that starts a new two-finger swipe
const PULL_THRESHOLD = 1.2;   // touchpad scroll units of a deliberate swipe that resizes the panel

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * The capsule that replaces the GNOME clock in the top bar.
 *
 * One actor morphs between five states: CLOSED (the time), HOVER (slightly
 * swollen, about to open), OPEN (the widgets or the tray), CARD (an event or
 * live-activity card) and DROP (files are dragged over it: the tray as a drop
 * target). Collapsed it floats inside the top bar; expanded it hangs from the
 * top edge, with the header in the band of the bar and the content below.
 *
 *   EventManager --events--> CardManager --host calls--> Osmin --> cards
 */
export class Osmin {
    /**
     * One capsule, on one monitor. The services, the event stream and the top bar belong to the
     * OsminHost and are shared by every capsule; everything that is seen and every gesture is here.
     * @param {SettingsService} settings
     * @param {{shared: {events, services, panel}, monitorIndex: () => number, leader: boolean,
     *          openPreferences?: Function}} options
     *   `leader`: the first capsule publishes the Live Activities of the widgets (once, for all).
     */
    constructor(settings, {shared, monitorIndex, leader, openPreferences = () => {}}) {
        this._settings = settings;
        this._shared = shared;
        this._monitorIndex = monitorIndex;
        this._leader = leader;
        this._openPreferences = openPreferences;
        this._state = null;
        this._signals = new SignalTracker();
        this._timers = new Timers();
        this._actor = null;
        this._ears = [];
        this._cardWidget = null;
        this._cardSize = null;
        this._cardToken = 0;
        this._resumeOpen = false;
        this._target = null;
        this._lastInteraction = 0;
        this._pinned = false;
        this._dragUris = null;
        this._localSend = null;
        this._localSendView = null;
        this._incoming = null;
        this._dragArmed = null;
        this._compactActivity = null;
        this._pinnedActivity = null; // what this capsule's user chose to see by scrolling
        this._knownActivities = new Set();
        this._hoverCard = false;     // the card on screen was brought by hovering the collapsed capsule
        this._openPage = null;
        this._destroying = false;
        this._grab = null;
        this._onTextInputEnd = null;
        this._scrollAccumulator = 0;
        this._expanded = false;      // a list (Clipboard / Alerts / LocalSend) grown to fit its items
        this._extraHeight = 0;       // px it is taller than normal, now
        this._baseOpenHeight = 0;
        this._swipe = null;
        this._approach = false;
        this._stageMotionId = 0;
    }

    /** Sources emit events here: `osmin.events.emit({...})`. */
    get events() {
        return this._events;
    }

    enable() {
        this._panel = this._shared.panel;
        this._events = this._shared.events;
        this._services = this._shared.services;
        try {
            this._touchpad = new Gio.Settings({schema_id: 'org.gnome.desktop.peripherals.touchpad'});
        } catch (e) {
            this._touchpad = null;
        }
        this._clock = new ClockService(now => this._onTick(now));
        this._cards = new CardManager(this);
        this._unsubscribe = this._events.subscribe(event => {
            // Some cards belong to one capsule (the one whose button was pressed).
            if (event.data?.target && event.data.target !== this)
                return;
            this._cards.show(event);
            if (!PANEL_STATES.has(this._state) && event.type !== EventType.ACTIVITY)
                this._closedView.setActivity(true);
        });
        this._activityHost = {cards: this._cards, isOpen: () => this._state === State.OPEN};
        this._services.activities.attach(this._activityHost);
        this._drag = new DragService();
        this._dragOut = new DragOutService({
            onBegin: () => this._beginDragOut(),
            onEnd: () => this._endDragOut(),
        });
        this._tray = new TrayController({
            services: this._services,
            settings: this._settings,
            dragOut: this._dragOut,
            onSend: uris => this._offerLocalSend(uris),
        });
        this._clipboardView = new ClipboardView({
            service: this._services.clipboard,
            ui: {
                beginTextInput: onEnd => this._beginTextInput(onEnd),
                endTextInput: () => this._endTextInput(),
            },
            onPaste: item => this._pasteClipboardItem(item),
            drag: this._dragOut && {
                warm: () => this._dragOut.warm(),
                arm: (payload, stillOver) => this._dragOut.arm(payload, stillOver),
                disarm: () => this._dragOut.disarm(),
                prepare: payload => this._dragOut.prepare(payload),
                begin: () => this._dragOut.begin(),
                cancel: () => this._dragOut.cancel(),
            },
        });
        this._notificationsView = new NotificationsView({service: this._services.notifications});
        this._commandView = new CommandView({
            clipboard: this._services.clipboard,
            ui: {
                beginTextInput: onEnd => this._beginTextInput(onEnd),
                endTextInput: () => this._endTextInput(),
            },
            onDone: () => this._settle(),
            onPaste: item => this._pasteClipboardItem(item),
        });
        this._localSend = new LocalSendSession({
            service: this._services.localSend,
            isVisible: () => this._state === State.OPEN && this._panelView?.mode === PanelMode.LOCALSEND,
            notify: (title, description, icon) => this._events.emit({
                type: EventType.CUSTOM, icon, title, description, duration: 4000,
            }),
        });
        this._clipboardView.onContentChanged = this._notificationsView.onContentChanged = () => this._onListChanged();
        this._localSendView = new LocalSendView({
            session: this._localSend,
            getTrayUris: () => this._services.files.items.map(item => item.uri),
            receiving: {
                get: () => this._settings.get('localsend-receive'),
                set: on => this._settings.gsettings?.set_boolean('localsend-receive', on),
            },
        });
        this._localSendView.onContentChanged = () => this._onListChanged();
        this._widgets = this._createWidgets();
        this._buildActor();
        this._applyAppearance();
        this._settings.connectObject('changed', (_s, key) => this._onSettingChanged(key), this);
        Main.layoutManager.addChrome(this._actor, {trackFullscreen: true});
        for (const ear of this._ears)
            Main.layoutManager.addChrome(ear, {trackFullscreen: true});

        this._signals.connect(St.ThemeContext.get_for_stage(global.stage),
            'notify::scale-factor', () => this._relayout());
        // Notice the pointer approaching the collapsed capsule, not only touching it.
        this._stageMotionId = global.stage.connect('captured-event', (_stage, event) => {
            if (event.type() === Clutter.EventType.MOTION)
                this._onStageMotion(event);
            return Clutter.EVENT_PROPAGATE;
        });

        this._services.activities.connectObject(
            'ongoing-changed', () => this._onOngoingChanged(),
            'compact-resized', () => this._onCompactResized(),
            this);
        this._services.camera.connectObject(
            'state-changed',
            () => this._panelView.setCameraActive(this._services.camera.state === CameraState.ON),
            this);
        this._startWidgets();
        this._tray.start();
        this._clock.start();
        this._drag.connectObject(
            'drag-started', (_s, uris) => this._onDragStarted(uris),
            'drag-moved', (_s, x, y) => this._onDragMoved(x, y),
            'drag-ended', (_s, result) => this._onDragEnded(result),
            this);
        this._drag.start();
        this._applyState(State.CLOSED, {animate: false});
    }

    destroy() {
        // Widgets end their activities while being destroyed: stop reacting to that first.
        this._destroying = true;
        this._settings?.disconnectObject(this);
        this._services?.activities.disconnectObject(this);
        this._services?.camera.disconnectObject(this);
        if (this._stageMotionId) {
            global.stage.disconnect(this._stageMotionId);
            this._stageMotionId = 0;
        }
        this._endTextInput();
        this._timers.destroy();
        this._signals.disconnectAll();
        this._unsubscribe?.();
        this._services?.activities.detach(this._activityHost);
        this._localSend?.destroy();
        this._localSend = null;
        this._localSendView?.destroy();
        this._localSendView = null;
        this._incoming?.destroy();
        this._incoming = null;
        this._cards?.destroy();
        this._clock?.destroy();
        this._widgets?.forEach(widget => widget.destroy());
        this._widgets = null;
        this._tray?.destroy();
        this._tray = null;
        this._clipboardView?.destroy();
        this._clipboardView = null;
        this._notificationsView?.destroy();
        this._notificationsView = null;
        this._commandView?.destroy();
        this._commandView = null;
        this._dragOut?.destroy();
        this._dragOut = null;
        this._drag?.destroy();
        this._drag = null;
        this._touchpad = null;
        this._services = this._events = this._panel = this._shared = null;
        this._unsubscribe = this._cards = null;
        this._clock = null;

        for (const ear of this._ears.splice(0)) {
            Main.layoutManager.removeChrome(ear);
            ear.destroy();
        }
        if (this._actor) {
            Main.layoutManager.removeChrome(this._actor);
            this._actor.destroy();
            this._actor = null;
        }
        this._cardWidget = null;

    }

    /** `pinned`: opened without the pointer (keyboard); stays until closed or the pointer visits it. */
    open({pinned = false} = {}) {
        this._pinned = pinned;
        if (this._state === State.CARD) {
            this._resumeOpen = true;
            this._cards.clear();
        } else {
            this._setState(State.OPEN);
        }
    }

    close() {
        if (this._state === State.OPEN)
            this._settle();
    }

    toggle() {
        if (this._state === State.OPEN)
            this.close();
        else
            this.open({pinned: true});
    }

    /**
     * Opens the panel on a section ('osmin', 'tray', 'localsend', 'clipboard', 'notifications' or 'command'); when that
     * section is already shown, closes it (a shortcut pressed twice).
     */
    openSection(section) {
        if (this._state === State.OPEN) {
            if (this._panelView.mode === section)
                this._settle();
            else
                this._panelView.setMode(section);
            this._pinned = true;
            this._timers.clear('leave');
            return;
        }
        this._openPage = section === 'osmin' ? null : section;
        this.open({pinned: true});
    }

    /** The widgets the user enabled, in the order they chose. */
    _createWidgets() {
        const byId = new Map(WIDGET_CLASSES.map(WidgetClass => [WidgetClass.id, WidgetClass]));
        return this._settings.enabledWidgets
            .filter(id => byId.has(id))
            .map(id => new (byId.get(id))({
                events: this._events,
                services: this._services,
                settings: this._settings,
                ui: {
                    beginTextInput: onEnd => this._beginTextInput(onEnd),
                    endTextInput: () => this._endTextInput(),
                    closeCapsule: () => this._settle(),
                    showCard: (activity, options) => this._services.activities.peek(activity, {...options, force: true, target: this}),
                    hideCard: activity => this._cards.hide(`activity:${activity.id}`),
                },
            }));
    }

    // --- settings ---------------------------------------------------------

    /** Colours, shadow and corner shape; the shape depends on whether the capsule hangs from the top. */
    _applyAppearance() {
        if (!this._actor)
            return;
        setAnimationSpeed(this._settings.get('animation-speed'));
        const radius = this._settings.get('corner-radius');
        const opacity = this._settings.get('background-opacity');
        const shadow = this._settings.get('shadow-strength');
        const background = `rgba(0, 0, 0, ${opacity})`;

        if (HANGING.has(this._state)) {
            // The collapsed notch is only ~36px tall: its corners are smaller than the open capsule's.
            const bottom = COLLAPSED.has(this._state) ? Math.min(radius, 14) : radius;
            this._actor.style = `border-radius: 0 0 ${bottom}px ${bottom}px; ` +
                `background-color: ${background}; border-top-width: 0; border-left-width: 1px; border-right-width: 1px; border-bottom-width: 1px; ` +
                `box-shadow: 0 14px 36px rgba(0, 0, 0, ${(0.55 * shadow).toFixed(2)});`;
        } else {
            this._actor.style = `border-radius: ${radius}px; background-color: ${background}; ` +
                `box-shadow: 0 2px 10px rgba(0, 0, 0, ${(0.4 * shadow).toFixed(2)});`;
        }
        for (const ear of this._ears)
            ear.setColor(0, 0, 0, opacity);
    }

    _onSettingChanged(key) {
        if (this._destroying || !this._actor)
            return;
        switch (key) {
        case 'animation-speed':
        case 'corner-radius':
        case 'background-opacity':
        case 'shadow-strength':
            this._applyAppearance();
            break;
        case 'collapsed-width-adjust':
            this._relayout();
            break;
        case 'size-scale':
        case 'width-mode':
        case 'fixed-width':
        case 'row-height':
        case 'content-padding':
        case 'widget-spacing':
        case 'show-dividers':
        case 'widget-cells':
            this._relayout();
            this._applyGeometry({duration: 260, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
            break;
        case 'activities-in-collapsed':
            this._syncCompact({force: true});
            break;
        case 'activity-media':
        case 'activity-timer':
        case 'activity-calendar':
            this._widgets.forEach(widget => widget.syncActivity());
            break;
        case 'tray-keep-files':
            this._services.files.persistChanged();
            break;
        case 'enabled-widgets':
            this._rebuildWidgets();
            break;
        }
    }

    /** The enabled widgets or their order changed: rebuild the content of the expanded capsule. */
    _rebuildWidgets() {
        const wanted = this._settings.enabledWidgets.join();
        if (wanted === this._widgets.map(w => w.constructor.id).join())
            return;
        if (PANEL_STATES.has(this._state))
            this._setState(State.CLOSED);
        this._endTextInput();

        // Widgets first: stopping the camera or ending an activity reports to the old panel.
        this._widgets.forEach(widget => widget.destroy());
        const old = this._panelView;
        this._content.remove_child(old);
        // The tray view is owned by the tray controller: take it out before destroying the panel.
        old.remove_tray();
        old.destroy();

        this._widgets = this._createWidgets();
        this._panelView = this._createPanelView();
        this._views[State.OPEN] = this._views[State.DROP] = this._panelView;
        this._panelView.opacity = 0;
        this._panelView.hide();
        this._content.add_child(this._panelView);
        this._startWidgets();
        this._panelView.tick(GLib.DateTime.new_now_local());
        this._relayout();
    }

    /** Only the first capsule publishes the widgets' Live Activities: they are shared by all. */
    _startWidgets() {
        if (this._leader)
            this._widgets.forEach(widget => widget.start());
    }

    _createPanelView() {
        const panel = new OsminPanel({
            widgets: this._widgets,
            tray: this._tray.view,
            localsend: this._localSendView,
            clipboard: this._clipboardView,
            notifications: this._notificationsView,
            command: this._commandView,
            // A list pulled taller is only for its own tab: the others go back to the normal height.
            onModeChanged: () => {
                this._expanded = false;
                if (this._state === State.OPEN && this._actor)
                    this._applyGeometry({duration: 200});
            },
            onOpenSettings: () => {
                this._settle();
                this._openPreferences();
            },
        });
        panel.setCameraActive(this._services.camera.state === CameraState.ON);
        return panel;
    }

    // --- CardManager host interface -------------------------------------

    showCard(card, onShown) {
        const token = ++this._cardToken;
        this._cardWidget?.destroy();

        const widget = createCard(card);
        widget.opacity = 0;
        widget.setPending(this._cards.pending);
        this._cardLayer.add_child(widget);
        this._cardWidget = widget;
        this._cardSize = widget.getSize();
        // The pointer is already on the capsule (it is what brought this card): keep the card.
        if (this._hoverCard && this._hovered())
            this._cards.pause();

        const alreadyCard = this._state === State.CARD;
        if (this._state === State.OPEN)
            this._resumeOpen = true;
        if (alreadyCard)
            this._applyGeometry(RESIZE);
        else
            this._setState(State.CARD);

        fadeIn(widget, {
            duration: 170,
            delay: alreadyCard ? 30 : 110,
            onComplete: () => {
                if (token === this._cardToken)
                    onShown();
            },
        });
    }

    updateCard(card, onDone) {
        const widget = this._cardWidget;
        if (!widget) {
            onDone();
            return;
        }
        const token = ++this._cardToken;

        fadeOut(widget, {
            duration: 80,
            hide: false,
            onComplete: () => {
                if (token !== this._cardToken)
                    return;
                let next = widget;
                if (cardClassFor(card) === widget.constructor) {
                    widget.update(card);
                } else {
                    widget.destroy();
                    next = createCard(card);
                    next.opacity = 0;
                    this._cardLayer.add_child(next);
                    this._cardWidget = next;
                }
                next.setPending(this._cards.pending);
                this._cardSize = next.getSize();
                this._applyGeometry(RESIZE);
                fadeIn(next, {
                    duration: 140,
                    onComplete: () => {
                        if (token === this._cardToken)
                            onDone();
                    },
                });
            },
        });
    }

    hideCard(_card, onHidden) {
        const widget = this._cardWidget;
        const token = ++this._cardToken;
        if (!widget) {
            onHidden();
            return;
        }
        fadeOut(widget, {
            duration: 100,
            hide: false,
            onComplete: () => {
                widget.destroy();
                if (this._cardWidget === widget)
                    this._cardWidget = null;
                if (token === this._cardToken)
                    onHidden();
            },
        });
    }

    setPending(count) {
        this._cardWidget?.setPending(count);
    }

    idle() {
        if (this._state !== State.CARD)
            return;
        if (this._resumeOpen) {
            this._resumeOpen = false;
            // Reopen the panel only if the user is still there (or asked for it).
            if (this._actor.hover || this._pinned)
                this._setState(State.OPEN);
            else
                this._settle();
        } else {
            this._settle();
        }
    }

    // --- capsule --------------------------------------------------------

    _buildActor() {
        this._actor = new St.Button({
            name: 'osmin',
            style_class: 'osmin',
            reactive: true,
            track_hover: true,
            can_focus: false,
            button_mask: St.ButtonMask.ONE,
        });

        this._content = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            clip_to_allocation: true,
            x_expand: true,
            y_expand: true,
        });
        this._actor.set_child(this._content);

        this._closedView = new ClosedView();
        // Cards sit below the band of the top bar.
        this._cardLayer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this._panelView = this._createPanelView();
        // CLOSED/HOVER share one view, OPEN/DROP share another: only the capsule differs.
        this._views = {
            [State.CLOSED]: this._closedView,
            [State.HOVER]: this._closedView,
            [State.OPEN]: this._panelView,
            [State.DROP]: this._panelView,
            [State.CARD]: this._cardLayer,
        };
        for (const view of new Set(Object.values(this._views))) {
            view.opacity = 0;
            view.hide();
            this._content.add_child(view);
        }
        this._ears = [new Ear('left'), new Ear('right')];

        // The shell may destroy the actor first (at shutdown): stop touching it then.
        this._actor.connect('destroy', () => {
            this._destroying = true;
            this._actor = null;
        });
        this._actor.connect('notify::hover', () => this._onHoverChanged());
        this._actor.connect('clicked', () => this._onClicked());
        // Middle click on the collapsed capsule: the next activity, or play / pause.
        this._actor.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_MIDDLE ||
                (this._state !== State.CLOSED && this._state !== State.HOVER))
                return Clutter.EVENT_PROPAGATE;
            switch (this._settings.get('gestures-middle-click')) {
            case 'play-pause': {
                const player = this._services.media.active;
                if (!player)
                    return Clutter.EVENT_PROPAGATE;
                this._timers.clear('dwell');
                player.playPause();
                return Clutter.EVENT_STOP;
            }
            case 'off':
                return Clutter.EVENT_STOP;
            default:
                if (this._cycleActivity(1)) {
                    this._timers.clear('dwell'); // the user is flipping through, not opening
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }
        });
        this._actor.connect('scroll-event', (_actor, event) => this._onScroll(event));
        // Remember when the user last used the open capsule, to not close it under their hand.
        this._actor.connect('captured-event', (_actor, event) => {
            // While the keyboard is grabbed, a click outside the capsule ends text input.
            if (this._grab && event.type() === Clutter.EventType.BUTTON_PRESS) {
                const [x, y] = event.get_coords();
                const t = this._target;
                if (!t || x < t.x || x > t.x + t.width || y < t.y || y > t.y + t.height) {
                    this._endTextInput();
                    return Clutter.EVENT_STOP;
                }
            }
            if (event.type() === Clutter.EventType.SCROLL && this._onPullScroll(event))
                return Clutter.EVENT_STOP;
            switch (event.type()) {
            case Clutter.EventType.BUTTON_PRESS:
            case Clutter.EventType.SCROLL:
            case Clutter.EventType.KEY_PRESS:
                this._lastInteraction = GLib.get_monotonic_time();
                break;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    // --- dragging files onto the capsule -----------------------------------

    /** Our own drag out of the tray is a native file drag too: the drop machinery must ignore it. */
    _ownDrag() {
        return this._draggingOut || !!this._dragOut?.busy;
    }

    _onDragStarted(uris) {
        if (this._ownDrag())
            return;
        this._dragUris = uris;
        this._dragArmed = null;
        this._panelView.tray.setDrop({active: false, count: uris.length});
    }

    _onDragMoved(x, y) {
        if (!this._dragUris || this._ownDrag() || this._state === State.CARD)
            return;
        const geo = this._geometry();
        const hot = Math.abs(x - geo.centerX) <= scaled(Layout.DROP_HOT_HALF_WIDTH) &&
            y <= geo.top + scaled(Layout.DROP_HOT_HEIGHT);

        if (hot && this._state !== State.DROP) {
            this._setState(State.DROP);
        } else if (!hot && this._state === State.DROP) {
            this._dragArmed = null;
            this._setState(State.CLOSED);
        }

        if (this._state === State.DROP && this._target) {
            this._dragArmed = this._panelView.tray.zoneAt(x, y, scaled(Layout.DROP_ARM_MARGIN));
            this._panelView.setDrop({active: true, zone: this._dragArmed, count: this._dragUris.length});
        }
    }

    async _onDragEnded({dropped, uris}) {
        if (!this._dragUris)
            return;
        const zone = this._dragArmed;
        this._dragUris = null;
        this._dragArmed = null;

        // The tray's activity shows the "Adding / Added" card.
        if (dropped && zone === 'tray')
            await this._services.files.add(uris);
        this._panelView?.setDrop({active: false});
        if (this._state === State.DROP)
            this._setState(State.CLOSED);
        if (dropped && zone === 'localsend')
            this._offerLocalSend(uris);
    }

    /** Files were dropped on the LocalSend target (or sent from the tray): they join the basket in the LocalSend section. */
    _offerLocalSend(uris) {
        this._localSend.offer(uris);
        if (this._state === State.OPEN)
            this._panelView.setMode(PanelMode.LOCALSEND);
        else
            this.openSection('localsend');
    }

    /** Someone wants to send files: a card asks, then shows the transfer. */
    showIncoming(transfer) {
        this._incoming?.destroy();
        const activity = new LocalSendReceiveActivity({
            transfer,
            onDismiss: () => this._cards.hide(`activity:${activity.id}`),
            showInFolder: uri => this._services.files.showInFolder(uri),
            notify: (title, description, icon) => this._events.emit({
                type: EventType.CUSTOM, icon, title, description, duration: 4000,
            }),
        });
        this._incoming = activity;
        this._services.activities.peek(activity, {persistent: true, priority: Priority.CRITICAL, force: true, target: this});
    }

    // --- clipboard -------------------------------------------------------------

    /** A card was clicked: put it on the clipboard and, by default, paste it where you were. */
    _pasteClipboardItem(item) {
        const clipboard = this._services.clipboard;
        clipboard.copy(item.id);
        if (!this._settings.get('clipboard-click-pastes'))
            return;
        this._endTextInput();
        this._timers.clear('dwell');
        this._setState(State.CLOSED);
        clipboard.sendPaste();
    }

    // --- dragging files out of the tray ----------------------------------------

    /** The capsule steps aside so the file can be dropped on whatever is below. */
    _beginDragOut() {
        this._timers.clear('leave');
        this._draggingOut = true;
        // The capsule stays on screen but lets input fall through to the window under it:
        // the drag-out helper's window has to receive the finger, and shell UI is stacked above
        // every window. (Only reactive actors are hit by the pointer, so switch them all off.)
        this._passThrough = new Map();
        const visit = actor => {
            if (actor.reactive) {
                this._passThrough.set(actor, true);
                actor.reactive = false;
            }
            for (const child of actor.get_children())
                visit(child);
        };
        visit(this._actor);
        // The file is out of the tray: the panel simply goes back to the default capsule.
        this._settle();
    }

    _endDragOut() {
        this._draggingOut = false;
        for (const actor of this._passThrough?.keys() ?? []) {
            try {
                actor.reactive = true;
            } catch (e) {
                // that actor was destroyed during the drag
            }
        }
        this._passThrough = null;
        if (!this._actor)
            return;
        // While it was see-through it never noticed the pointer leaving, so it still believes
        // it is hovered; unmapping and mapping it again (within one frame) clears that.
        this._actor.hide();
        this._actor.show();
    }

    // --- keyboard input for widgets (the to-do entry) -------------------------

    /**
     * Gives the keyboard to the capsule: needed for text entries, because
     * the capsule is not a window. The grab ends on Escape, on a click
     * outside the capsule, or when the capsule closes.
     */
    _beginTextInput(onEnd) {
        if (this._grab)
            return;
        this._onTextInputEnd = onEnd;
        this._timers.clear('leave');
        this._grab = Main.pushModal(this._actor, {actionMode: Shell.ActionMode.POPUP});
    }

    _endTextInput() {
        if (!this._grab)
            return;
        const grab = this._grab;
        this._grab = null;
        Main.popModal(grab);
        const callback = this._onTextInputEnd;
        this._onTextInputEnd = null;
        callback?.();
        // The pointer may be elsewhere by now: collapse after the usual delay.
        if (this._state === State.OPEN && !this._actor?.hover)
            this._timers.set('leave', OPEN_LEAVE_MS, () => this._settle());
    }

    _onTick(now) {
        this._closedView.setTime(formatTime(now, {timeOnly: true}));
        this._closedView.setDate(now.format('%a %-e %b'));
        this._panelView.tick(now);
        // The collapsed capsule is as wide as its time text.
        if (this._actor && (this._state === State.CLOSED || this._state === State.HOVER))
            this._applyGeometry({duration: 200});
        else
            this._syncAnchor();
    }

    // --- pointer ---------------------------------------------------------

    /**
     * The pointer near the collapsed capsule (within a margin, including the
     * very top edge of the screen) counts as hovering it, so it is easy to hit.
     */
    _onStageMotion(event) {
        if (this._destroying || !this._actor || this._draggingOut)
            return;
        if (this._state !== State.CLOSED && !this._approach)
            return;
        const [x, y] = event.get_coords();
        const t = this._target;
        const margin = scaled(Layout.APPROACH_MARGIN);
        const near = !!t && this._state === State.CLOSED &&
            x >= t.x - margin && x <= t.x + t.width + margin &&
            y >= this._geometry().top && y <= t.y + t.height + margin;
        if (near !== this._approach) {
            this._approach = near;
            if (!this._actor.hover)
                this._onHoverChanged();
        }
    }

    _hovered() {
        return this._actor.hover || (this._approach && this._state === State.CLOSED);
    }

    _onHoverChanged() {
        // While a file is dragged out of the tray the capsule is hidden and must stay quiet.
        if (this._draggingOut)
            return;
        const hovered = this._hovered();
        this._timers.clear('hover');

        switch (this._state) {
        case State.CLOSED:
            // Brushing the top bar must not open anything: rest first, then swell, then open.
            if (hovered) {
                this._timers.set('hover', HOVER_INTENT_MS, () => {
                    // Something is going on (music, a timer, a meeting): its card comes first;
                    // a click on it opens the panel, moving the pointer away closes it again.
                    if (this._compactActivity && this._settings.get('open-on-hover')) {
                        this._showActivityCard();
                        return;
                    }
                    this._setState(State.HOVER);
                    if (this._settings.get('open-on-hover'))
                        this._timers.set('dwell', OPEN_DWELL_MS, () => this._setState(State.OPEN));
                });
            }
            break;
        case State.HOVER:
            if (hovered) {
                if (this._settings.get('open-on-hover'))
                    this._timers.set('dwell', OPEN_DWELL_MS, () => this._setState(State.OPEN));
            } else {
                this._timers.clear('dwell');
                this._timers.set('hover', HOVER_LEAVE_MS, () => this._setState(State.CLOSED));
            }
            break;
        case State.OPEN:
            if (hovered) {
                this._pinned = false;
                this._timers.clear('leave');
            } else if (!this._pinned && !this._grab && this._settings.get('auto-collapse')) {
                const recent = GLib.get_monotonic_time() - this._lastInteraction <
                    INTERACTION_GRACE_MS * 1000;
                this._timers.set('leave', OPEN_LEAVE_MS + (recent ? INTERACTION_GRACE_MS : 0),
                    () => this._settle());
            }
            break;
        case State.CARD:
            // Keep a card on screen while the pointer is on it.
            if (hovered) {
                this._timers.clear('leave');
                this._cards.pause();
            } else {
                this._cards.resume();
                // The card that hovering brought goes away as soon as the pointer does.
                if (this._hoverCard)
                    this._timers.set('leave', OPEN_LEAVE_MS, () => this._cards.hideCurrent());
            }
            break;
        }
    }

    /** Hovering the collapsed capsule while an activity is going on: show that activity's card. */
    _showActivityCard() {
        const activity = this._compactActivity;
        if (!activity)
            return;
        this._hoverCard = true;
        this._services.activities.peek(activity, {duration: 6000, priority: Priority.HIGH, force: true, target: this});
    }

    _onClicked() {
        switch (this._state) {
        case State.OPEN:
        case State.DROP:
            break;
        case State.CARD: {
            // A Live Activity card opens its widget; any other card is dismissed.
            const activity = this._cards.currentCard?.data?.activity;
            if (activity) {
                this._openPage = activity.widgetId;
                this.open();
            } else {
                this._cards.hideCurrent();
            }
            break;
        }
        default:
            this._setState(State.OPEN);
        }
    }

    /**
     * Two fingers down on the Clipboard / Alerts / LocalSend list grow the panel to fit its items
     * (at most 40% of the screen), two fingers up bring it back. A list that can still scroll in
     * the swipe's direction just scrolls: the panel only resizes when the list has reached its end
     * (or has nothing to scroll). The decision is made once per swipe, so the tail of a swipe that
     * scrolled to the end does not resize it.
     * @returns {boolean} whether the swipe was used for this
     */
    _onPullScroll(event) {
        if (this._state !== State.OPEN || !this._panelView.growable ||
            event.get_scroll_direction() !== Clutter.ScrollDirection.SMOOTH ||
            event.get_scroll_source() === Clutter.ScrollSource.WHEEL)
            return false;
        const [dx, dy] = event.get_scroll_delta();
        if (Math.abs(dy) <= Math.abs(dx) || dy === 0)
            return false;
        const now = GLib.get_monotonic_time() / 1000;
        if (!this._swipe || now - this._swipe.last > PULL_GAP_MS)
            this._swipe = {mode: this._pullMode(event, dy), sum: 0, fired: false, last: now};
        const swipe = this._swipe;
        swipe.last = now;
        if (swipe.mode === 'scroll')
            return false;
        this._timers.clear('leave');
        if (swipe.fired)
            return true;
        swipe.sum += Math.abs(dy);
        if (swipe.sum >= PULL_THRESHOLD) {
            swipe.fired = true;
            this._expanded = swipe.mode === 'expand';
            this._applyGeometry({duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
        return true;
    }

    /** What a new swipe does: 'scroll' (the list's own), 'expand' or 'collapse' the panel. */
    _pullMode(event, dy) {
        // With natural scrolling the content follows the fingers, so "fingers down" is a negative delta.
        const natural = this._touchpad?.get_boolean('natural-scroll') ?? true;
        const fingersDown = natural ? dy < 0 : dy > 0;
        const towardTop = dy < 0;
        const [x, y] = event.get_coords();
        const target = this._panelView.scrollTargets.find(({scroll}) => {
            const [sx, sy] = scroll.get_transformed_position();
            return x >= sx && x <= sx + scroll.width && y >= sy && y <= sy + scroll.height;
        }) ?? this._panelView.scrollTargets[0];
        if (target) {
            const adjustment = target.scroll.vadjustment;
            const room = adjustment.upper - adjustment.page_size;
            // Still room to scroll that way: the swipe belongs to the list.
            if (room > 1 && (towardTop ? adjustment.value > 1 : adjustment.value < room - 1))
                return 'scroll';
        }
        if (fingersDown && !this._expanded && this._fitExtra() > 0)
            return 'expand';
        if (!fingersDown && this._expanded)
            return 'collapse';
        return 'scroll';
    }

    /** How much taller than normal the open list must be to show all its items, within 40% of the screen. */
    _fitExtra() {
        return this._fitExtraFrom(this._extraHeight);
    }

    /** `applied`: the extra height the lists on screen have now. */
    _fitExtraFrom(applied) {
        const monitor = this._geometry().monitor;
        const cap = Math.max(0, Math.round(monitor.height * Layout.EXPANDED_MAX_HEIGHT_RATIO) - this._baseOpenHeight);
        let overflow = null;
        for (const {scroll, list} of this._panelView.scrollTargets) {
            const value = listOverflow(scroll, list);
            if (value !== null)
                overflow = Math.max(overflow ?? -Infinity, value);
        }
        return overflow === null ? cap : clamp(overflow + applied, 0, cap);
    }

    /** The items of an open list changed: a grown panel follows the new count. */
    _onListChanged() {
        if (this._state === State.OPEN && ((this._expanded && this._panelView.growable) || this._panelView.mode === PanelMode.LOCALSEND))
            this._applyGeometry({duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    /**
     * Scrolling over the capsule: pages of the open panel, or the ongoing
     * activities of the collapsed capsule. Deliberately hard to trigger by
     * accident: one step per notch / swipe, then a short lock.
     */
    _onScroll(event) {
        let step = 0;
        let axis = 'vertical';
        // Opening and closing are for touchpad swipes; a mouse wheel keeps flipping pages.
        const swipe = event.get_scroll_source() !== Clutter.ScrollSource.WHEEL;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
            step = -1;
            break;
        case Clutter.ScrollDirection.DOWN:
            step = 1;
            break;
        case Clutter.ScrollDirection.LEFT:
            step = -1;
            axis = 'horizontal';
            break;
        case Clutter.ScrollDirection.RIGHT:
            step = 1;
            axis = 'horizontal';
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            const [dx, dy] = event.get_scroll_delta();
            const horizontal = Math.abs(dx) > Math.abs(dy);
            axis = horizontal ? 'horizontal' : 'vertical';
            this._scrollAccumulator += horizontal ? dx : dy;
            // A pause between swipes starts a new gesture.
            this._timers.set('scroll-reset', 250, () => {
                this._scrollAccumulator = 0;
            });
            if (Math.abs(this._scrollAccumulator) >= SCROLL_THRESHOLD)
                step = Math.sign(this._scrollAccumulator);
            break;
        }
        default:
            return Clutter.EVENT_PROPAGATE;
        }

        if (this._state !== State.OPEN && this._state !== State.CLOSED && this._state !== State.HOVER)
            return Clutter.EVENT_PROPAGATE;
        // In the tray the wheel belongs to the row of files.
        if (this._state === State.OPEN && this._panelView.mode !== 'osmin')
            return Clutter.EVENT_PROPAGATE;
        if (step === 0 || this._timers.has('scroll-lock'))
            return Clutter.EVENT_STOP;

        this._scrollAccumulator = 0;
        this._timers.set('scroll-lock', SCROLL_LOCK_MS, () => {});
        if (this._settings.get('gestures-invert'))
            step = -step;

        if (this._state === State.OPEN) {
            // Up closes (from the first page); anything else leafs through the pages.
            if (swipe && axis === 'vertical' && step < 0 && this._panelView.pageIndex === 0 &&
                this._settings.get('gestures-swipe-close')) {
                this._timers.clear('dwell');
                this._setState(State.CLOSED);
            } else {
                this._panelView.showPage(this._panelView.pageIndex + step);
            }
            return Clutter.EVENT_STOP;
        }

        // The collapsed capsule: down opens, sideways skips tracks, else flips activities.
        if (swipe && axis === 'vertical' && step > 0 && this._settings.get('gestures-swipe-open')) {
            this._timers.clear('dwell');
            this._setState(State.OPEN);
            return Clutter.EVENT_STOP;
        }
        const player = this._services.media.active;
        if (axis === 'horizontal' && player && this._settings.get('gestures-media-swipe')) {
            if (step > 0)
                player.next();
            else
                player.previous();
            return Clutter.EVENT_STOP;
        }
        this._cycleActivity(step);
        return Clutter.EVENT_STOP;
    }

    /**
     * The set of ongoing activities changed. What this capsule's user chose by scrolling is forgotten
     * when something new starts (or the chosen one ends); other capsules keep their own choice.
     */
    _onOngoingChanged() {
        const ids = new Set(this._services.activities.ongoing.map(a => a.id));
        const started = [...ids].some(id => !this._knownActivities.has(id));
        this._knownActivities = ids;
        if (started || (this._pinnedActivity && !ids.has(this._pinnedActivity)))
            this._pinnedActivity = null;
        this._syncCompact();
    }

    /** Scrolling the collapsed capsule: shows the next ongoing activity, on this capsule only. */
    _cycleActivity(direction) {
        const id = this._services.activities.next(direction, this._pinnedActivity);
        if (!id)
            return false;
        this._pinnedActivity = id;
        this._syncCompact();
        return true;
    }

    /** Shows the ongoing activity with the highest priority in the collapsed capsule. */
    _syncCompact({force = false} = {}) {
        if (this._destroying || !this._actor)
            return;
        const activity = this._settings.get('activities-in-collapsed')
            ? this._services.activities.pick(this._pinnedActivity) : null;
        if (activity === this._compactActivity && !force)
            return;
        this._compactActivity = activity;
        this._closedView.setCompact(activity ? activity.createCompactParts() : null);
        this._onCompactResized();
    }

    /** The compact content changed: the collapsed capsule follows its width. */
    _onCompactResized() {
        if (this._destroying || !this._actor)
            return;
        if (this._state === State.CLOSED || this._state === State.HOVER)
            this._applyGeometry({duration: 220});
        else
            this._syncAnchor();
    }

    /** Falls back to HOVER while the pointer is still over the capsule, else CLOSED. */
    _settle() {
        this._timers.clear('leave');
        this._timers.clear('dwell');
        // After a deliberate close the capsule should rest, not pop open again.
        this._setState(State.CLOSED);
    }

    _setState(state) {
        if (state === this._state)
            return;
        this._applyState(state, {animate: true});
    }

    _applyState(state, {animate}) {
        const previous = this._state;
        this._state = state;
        this._timers.clear('leave');
        if (state !== State.HOVER)
            this._timers.clear('dwell');
        this._approach = false;
        if (state !== State.OPEN && state !== State.DROP) {
            this._expanded = false;
            this._extraHeight = 0;
        }

        if (previous !== State.CARD && state !== State.CARD)
            this._resumeOpen = false;
        if (previous === State.CARD) {
            this._cards.resume();
            this._cardSize = null;
            this._hoverCard = false;
        }

        const wasPanel = PANEL_STATES.has(previous);
        const isPanel = PANEL_STATES.has(state);
        if (wasPanel && !isPanel) {
            this._endTextInput();
            this._panelView.setOpen(false);
            this._panelView.conceal();
        }

        // The old view fades out quickly. The panel's content reveals itself piece by
        // piece (header, then each widget); the other views fade in once the capsule
        // has started to grow. The card layer is not faded: the cards fade themselves.
        const previousView = previous ? this._views[previous] : null;
        const nextView = this._views[state];
        if (previousView && previousView !== nextView)
            fadeOut(previousView, {duration: 90});
        if (previousView !== nextView) {
            if (isPanel && animate) {
                nextView.remove_all_transitions();
                nextView.show();
                nextView.opacity = 255;
                this._panelView.reveal();
            } else if (animate && state !== State.CARD) {
                fadeIn(nextView, {duration: 170, delay: state === State.CLOSED ? 90 : 90});
            } else {
                nextView.remove_all_transitions();
                nextView.show();
                nextView.opacity = 255;
            }
        }

        if (state === State.OPEN) {
            // Open on the widget of the ongoing activity (or the one that was clicked).
            const page = this._openPage ?? this._compactActivity?.widgetId;
            this._openPage = null;
            if (this._panelView.mode !== 'osmin' && !page)
                this._panelView.setMode('osmin', {animate: false});
            if (page)
                this._panelView.showWidget(page);
            this._panelView.setOpen(true);
            this._closedView.setActivity(false);
            if (!this._actor.hover && !this._pinned && this._settings.get('auto-collapse'))
                this._timers.set('leave', OPEN_LEAVE_MS, () => this._settle());
        } else {
            this._pinned = false;
        }
        if (state === State.DROP) {
            this._panelView.setOpen(false);
            this._panelView.setDrop({active: true, count: this._dragUris?.length ?? 0});
        }

        this._applyAppearance();
        // Closing: the content fades first, then the container shrinks.
        const delay = wasPanel && !isPanel && animate ? 70 : 0;
        this._applyGeometry(animate ? {...Motion[state], delay} : {duration: 0});
    }

    // --- geometry (all values below are real px, already scaled) ---------

    _closedSize(geo) {
        return {
            width: Math.max(scaled(Layout.CLOSED_MIN_WIDTH),
                this._closedView.getNaturalWidth() + scaled(Layout.CLOSED_PADDING) +
                scaled(this._settings.get('collapsed-width-adjust'))),
            height: Math.max(geo.height + scaled(Layout.CLOSED_EXTRA_HEIGHT), scaled(24)),
        };
    }

    /** The expanded size follows from the layout engine: widgets, spacing, paddings. */
    _openSize(geo) {
        const scale = getScaleFactor();
        const layout = computeLayout({
            monitorCss: geo.monitor.width / scale,
            widgetIds: this._widgets.map(widget => widget.constructor.id),
            cellsFor: id => this._settings.cellsFor(id),
            settings: this._settings,
        });
        this._panelView.applyLayout(layout, {scale, headerHeight: geo.height});
        const width = Math.round(layout.widthCss * scale);
        const normalCap = Math.round(geo.monitor.height * Layout.OPEN_MAX_HEIGHT_RATIO);
        if (!this._panelView.growable)
            this._expanded = false;
        // A list grown to fit its items (the size is measured with the panel at its normal height).
        this._panelView.setExtraHeight(0);
        let base = Math.min(this._panelView.getHeightForWidth(width), normalCap);
        // A section that is not a scrolling list (LocalSend) simply gets the height it needs.
        const needed = this._panelView.contentExtra(width);
        if (needed > 0) {
            this._panelView.setExtraHeight(needed);
            base = Math.min(this._panelView.getHeightForWidth(width), normalCap);
        }
        const previous = this._extraHeight;
        this._baseOpenHeight = base;
        this._extraHeight = this._expanded ? this._fitExtraFrom(previous) : 0;
        if (this._extraHeight <= 0)
            return {width, height: base};
        this._panelView.setExtraHeight(needed + this._extraHeight);
        return {width, height: Math.min(this._panelView.getHeightForWidth(width), base + this._extraHeight)};
    }

    _sizeFor(state, geo) {
        switch (state) {
        case State.HOVER: {
            const closed = this._closedSize(geo);
            return {width: closed.width + scaled(Layout.HOVER_GROW), height: closed.height};
        }
        case State.OPEN:
        case State.DROP:
            return this._openSize(geo);
        case State.CARD:
            if (this._cardSize) {
                return {
                    width: scaled(this._cardSize.width),
                    height: geo.height + scaled(this._cardSize.height - CARD_OVERLAP),
                };
            }
            return this._closedSize(geo);
        default:
            return this._closedSize(geo);
        }
    }

    _geometryFor(state) {
        const geo = this._geometry();
        const size = this._sizeFor(state, geo);
        const margin = scaled(Layout.SCREEN_MARGIN);
        const x = clamp(Math.round(geo.centerX - size.width / 2),
            geo.monitor.x + margin,
            Math.max(geo.monitor.x + margin, geo.monitor.x + geo.monitor.width - size.width - margin));
        // Collapsed it floats inside the bar; expanded it hangs from the top edge.
        const y = HANGING.has(state) ? geo.top : geo.top + scaled(Layout.PANEL_INSET);
        return {x, y, ...size};
    }

    _applyGeometry({duration, mode = Clutter.AnimationMode.EASE_OUT_CUBIC, delay = 0}) {
        this._syncAnchor();
        this._target = this._geometryFor(this._state);
        const params = {duration: animDuration(duration), delay: animDuration(delay), mode};
        this._actor.ease({...this._target, ...params});
        this._placeEars(params);
    }

    /** The ears follow the capsule's sides, at the very top edge of the screen where it hangs from. */
    _placeEars(params = null) {
        if (this._ears.length === 0)
            return;
        const geo = this._geometry();
        const target = this._target;
        const radius = scaled(COLLAPSED.has(this._state) ? Layout.EAR_RADIUS_CLOSED : Layout.EAR_RADIUS);
        const show = HANGING.has(this._state);
        // The ears cover the capsule's 1px side border along their height, so the border
        // turns into the curve instead of running straight up beside it.
        const border = Math.max(1, Math.round(scaled(1)));
        const x = [target.x - radius, target.x + target.width - border];
        this._ears.forEach((ear, i) => {
            ear.y = geo.top;
            if (show) {
                ear.show();
                if (params) {
                    ear.ease({x: x[i], width: radius + border, height: radius, ...params});
                } else {
                    ear.set_size(radius + border, radius);
                    ear.x = x[i];
                }
                // Fade in once the capsule is under way; fade out with it.
                ear.ease({
                    opacity: 255,
                    duration: animDuration(params ? 160 : 0),
                    delay: animDuration(params ? 120 : 0),
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else {
                ear.set_size(radius + border, radius);
                ear.x = x[i];
                ear.ease({
                    opacity: 0,
                    duration: animDuration(params ? 90 : 0),
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => ear.hide(),
                });
            }
        });
    }

    /** Keeps the empty spot in the top bar as wide as the collapsed capsule. */
    _syncAnchor() {
        if (!this._actor)
            return;
        const geo = this._geometry();
        // The top bar's spot is reserved for the capsule that sits on the bar.
        if (geo.monitor.index === Main.layoutManager.primaryIndex)
            this._panel.setAnchorWidth(this._closedSize(geo).width);
        // Cards hang below the band of the top bar.
        const top = Math.round(geo.height / getScaleFactor());
        if (this._cardTop !== top) {
            this._cardTop = top;
            this._cardLayer.style = `padding-top: ${Math.max(0, top - CARD_OVERLAP)}px;`;
        }
    }

    _geometry() {
        return this._panel.getGeometry(this._monitorIndex());
    }

    /** Re-applies the geometry without animation (monitor, scale or panel changes). */
    _relayout() {
        if (!this._actor || this._state === null)
            return;
        this._syncAnchor();
        const target = this._geometryFor(this._state);
        const same = this._target && ['x', 'y', 'width', 'height']
            .every(key => this._target[key] === target[key]);
        if (same)
            return;
        this._target = target;
        this._actor.remove_all_transitions();
        this._actor.set_position(target.x, target.y);
        this._actor.set_size(target.width, target.height);
        this._ears.forEach(ear => ear.remove_all_transitions());
        this._placeEars();
    }
}
