import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';

import {ActivityManager} from './services/activityManager.js';
import {ArtworkService} from './services/artworkService.js';
import {CalendarService} from './services/calendarService.js';
import {CameraService, CameraState} from './services/cameraService.js';
import {CardManager} from './services/cardManager.js';
import {ClockService} from './services/clockService.js';
import {DragService} from './services/dragService.js';
import {EventManager} from './services/eventManager.js';
import {FileService} from './services/fileService.js';
import {MediaService} from './services/mediaService.js';
import {PanelService} from './services/panelService.js';
import {TimerService} from './services/timerService.js';
import {TodoService} from './services/todoService.js';
import {DragOutService} from './tray/dragOut.js';
import {TrayController} from './tray/trayController.js';
import {ClosedView} from './ui/closedView.js';
import {Ear} from './ui/ear.js';
import {computeLayout} from './ui/osminLayout.js';
import {OsminPanel} from './ui/osminPanel.js';
import {cardClassFor, createCard} from './ui/cardFactory.js';
import {WIDGET_CLASSES} from './widgets/registry.js';
import {animDuration, fadeIn, fadeOut, setAnimationSpeed} from './utils/animation.js';
import {
    HOVER_INTENT_MS, HOVER_LEAVE_MS, INTERACTION_GRACE_MS, Layout, Motion, OPEN_DWELL_MS,
    OPEN_LEAVE_MS, SCROLL_LOCK_MS, SCROLL_THRESHOLD, State,
} from './utils/constants.js';
import {EventType} from './utils/events.js';
import {getScaleFactor, scaled} from './utils/scale.js';
import {SignalTracker} from './utils/signals.js';
import {Timers} from './utils/timers.js';

// Resizing between two cards, or after a card update: calm, no overshoot.
const RESIZE = {duration: 220, mode: Clutter.AnimationMode.EASE_OUT_CUBIC};

// States in which the capsule hangs from the top edge (the rest sit inside the bar).
const HANGING = new Set([State.OPEN, State.CARD, State.DROP]);
// States that show the panel (widgets / tray).
const PANEL_STATES = new Set([State.OPEN, State.DROP]);

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
     * @param {SettingsService} settings
     * @param {{openPreferences?: Function}} [options]
     */
    constructor(settings, {openPreferences = () => {}} = {}) {
        this._settings = settings;
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
        this._dragArmed = null;
        this._compactActivity = null;
        this._openPage = null;
        this._destroying = false;
        this._grab = null;
        this._onTextInputEnd = null;
        this._scrollAccumulator = 0;
        this._approach = false;
        this._stageMotionId = 0;
    }

    /** Sources emit events here: `osmin.events.emit({...})`. */
    get events() {
        return this._events;
    }

    enable() {
        this._panel = new PanelService({
            onChanged: () => this._relayout(),
            onToggleRequest: () => this.toggle(),
        });
        this._clock = new ClockService(now => this._onTick(now));
        this._events = new EventManager();
        this._cards = new CardManager(this);
        this._unsubscribe = this._events.subscribe(event => {
            this._cards.show(event);
            if (!PANEL_STATES.has(this._state) && event.type !== EventType.ACTIVITY)
                this._closedView.setActivity(true);
        });

        this._services = {
            media: new MediaService(),
            artwork: new ArtworkService(),
            files: new FileService({persist: () => this._settings.get('tray-keep-files')}),
            calendar: new CalendarService(),
            activities: new ActivityManager(this._events),
            timer: new TimerService(),
            todo: new TodoService(),
            camera: new CameraService(),
        };
        this._services.activities.attach({
            cards: this._cards,
            isOpen: () => this._state === State.OPEN,
        });
        this._drag = new DragService();
        this._dragOut = new DragOutService({
            onBegin: () => this._beginDragOut(),
            onEnd: () => this._endDragOut(),
        });
        this._tray = new TrayController({services: this._services, settings: this._settings, dragOut: this._dragOut});
        this._widgets = this._createWidgets();
        this._buildActor();
        this._applyAppearance();
        this._settings.connectObject('changed', (_s, key) => this._onSettingChanged(key), this);
        this._panel.enable();
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
            'ongoing-changed', () => this._syncCompact(),
            'compact-resized', () => this._onCompactResized(),
            this);
        this._services.camera.connectObject(
            'state-changed',
            () => this._panelView.setCameraActive(this._services.camera.state === CameraState.ON),
            this);
        this._widgets.forEach(widget => widget.start());
        this._tray.start();
        this._services.timer.load();
        this._services.todo.load();
        this._clock.start();
        this._services.media.start();
        this._services.calendar.start().catch(e => console.warn(`[osmin] calendar failed: ${e.message}`));
        this._services.files.load().catch(e => console.warn(`[osmin] loading the file tray failed: ${e.message}`));
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
        this._cards?.destroy();
        this._events?.destroy();
        this._clock?.destroy();
        this._widgets?.forEach(widget => widget.destroy());
        this._widgets = null;
        this._tray?.destroy();
        this._tray = null;
        this._dragOut?.destroy();
        this._dragOut = null;
        this._drag?.destroy();
        this._drag = null;
        this._services?.media.destroy();
        this._services?.artwork.destroy();
        this._services?.files.destroy();
        this._services?.calendar.destroy();
        this._services?.activities.destroy();
        this._services?.timer.destroy();
        this._services?.todo.destroy();
        this._services?.camera.destroy();
        this._services = null;
        this._unsubscribe = this._cards = this._events = null;
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

        // Last: brings the GNOME clock back.
        this._panel?.destroy();
        this._panel = null;
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
        const background = `rgba(14, 14, 16, ${opacity})`;

        if (HANGING.has(this._state)) {
            this._actor.style = `border-radius: 0 0 ${radius}px ${radius}px; ` +
                `background-color: ${background}; border-width: 0 1px 1px 1px; ` +
                `box-shadow: 0 14px 36px rgba(0, 0, 0, ${(0.55 * shadow).toFixed(2)});`;
        } else {
            this._actor.style = `border-radius: ${radius}px; background-color: ${background}; ` +
                `box-shadow: 0 2px 10px rgba(0, 0, 0, ${(0.4 * shadow).toFixed(2)});`;
        }
        for (const ear of this._ears)
            ear.setColor(14, 14, 16, opacity);
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
        this._widgets.forEach(widget => widget.start());
        this._panelView.tick(GLib.DateTime.new_now_local());
        this._relayout();
    }

    _createPanelView() {
        const panel = new OsminPanel({
            widgets: this._widgets,
            tray: this._tray.view,
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
                if (this._services.activities.cycle(1)) {
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

    _onDragStarted(uris) {
        this._dragUris = uris;
        this._dragArmed = null;
        this._panelView.tray.setDrop({active: false, count: uris.length});
    }

    _onDragMoved(x, y) {
        if (!this._dragUris || this._state === State.CARD)
            return;
        const geo = this._panel.getGeometry();
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
        const zone = this._dragArmed;
        this._dragUris = null;
        this._dragArmed = null;

        // The tray's activity shows the "Adding / Added" card.
        if (dropped && zone === 'tray')
            await this._services.files.add(uris);
        else if (dropped && zone === 'bluetooth')
            this._services.files.sendViaBluetooth(uris);
        this._panelView?.setDrop({active: false});
        if (this._state === State.DROP)
            this._setState(State.CLOSED);
    }

    // --- dragging files out of the tray ----------------------------------------

    /** The capsule steps aside so the file can be dropped on whatever is below. */
    _beginDragOut() {
        this._timers.clear('leave');
        this._draggingOut = true;
        this._actor.hide();
        for (const ear of this._ears)
            ear.hide();
    }

    _endDragOut() {
        this._draggingOut = false;
        if (!this._actor)
            return;
        this._actor.show();
        // Ears belong to the open capsule only: it settles back to the collapsed one.
        if (this._state === State.OPEN)
            this._settle();
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
        if (this._destroying || !this._actor)
            return;
        if (this._state !== State.CLOSED && !this._approach)
            return;
        const [x, y] = event.get_coords();
        const t = this._target;
        const margin = scaled(Layout.APPROACH_MARGIN);
        const near = !!t && this._state === State.CLOSED &&
            x >= t.x - margin && x <= t.x + t.width + margin &&
            y >= this._panel.getGeometry().top && y <= t.y + t.height + margin;
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
        const hovered = this._hovered();
        this._timers.clear('hover');

        switch (this._state) {
        case State.CLOSED:
            // Brushing the top bar must not open anything: rest first, then swell, then open.
            if (hovered) {
                this._timers.set('hover', HOVER_INTENT_MS, () => {
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
            if (hovered)
                this._cards.pause();
            else
                this._cards.resume();
            break;
        }
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
        this._services.activities.cycle(step);
        return Clutter.EVENT_STOP;
    }

    /** Shows the ongoing activity with the highest priority in the collapsed capsule. */
    _syncCompact({force = false} = {}) {
        if (this._destroying || !this._actor)
            return;
        const activity = this._settings.get('activities-in-collapsed')
            ? this._services.activities.compact : null;
        if (activity === this._compactActivity && !force)
            return;
        this._compactActivity = activity;
        this._closedView.setCompact(activity ? activity.createCompactView() : null);
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

        if (previous !== State.CARD && state !== State.CARD)
            this._resumeOpen = false;
        if (previous === State.CARD) {
            this._cards.resume();
            this._cardSize = null;
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
        const inset = scaled(Layout.PANEL_INSET);
        return {
            width: Math.max(scaled(Layout.CLOSED_MIN_WIDTH),
                this._closedView.getNaturalWidth() + scaled(Layout.CLOSED_PADDING)),
            height: Math.max(geo.height - 2 * inset, scaled(16)),
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
        const height = Math.min(this._panelView.getHeightForWidth(width),
            Math.round(geo.monitor.height * Layout.OPEN_MAX_HEIGHT_RATIO));
        return {width, height};
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
                    height: geo.height + scaled(this._cardSize.height),
                };
            }
            return this._closedSize(geo);
        default:
            return this._closedSize(geo);
        }
    }

    _geometryFor(state) {
        const geo = this._panel.getGeometry();
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

    /** The ears follow the capsule's sides, at the bottom edge of the bar. */
    _placeEars(params = null) {
        if (this._ears.length === 0)
            return;
        const geo = this._panel.getGeometry();
        const target = this._target;
        const radius = scaled(Layout.EAR_RADIUS);
        const show = HANGING.has(this._state);
        const x = [target.x - radius, target.x + target.width];
        this._ears.forEach((ear, i) => {
            ear.set_size(radius, radius);
            ear.y = geo.top + geo.height;
            if (show) {
                ear.show();
                if (params)
                    ear.ease({x: x[i], ...params});
                else
                    ear.x = x[i];
                // Fade in once the capsule is under way; fade out with it.
                ear.ease({
                    opacity: 255,
                    duration: animDuration(params ? 160 : 0),
                    delay: animDuration(params ? 120 : 0),
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else {
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
        const geo = this._panel.getGeometry();
        this._panel.setAnchorWidth(this._closedSize(geo).width);
        // Cards hang below the band of the top bar.
        const top = Math.round(geo.height / getScaleFactor());
        if (this._cardTop !== top) {
            this._cardTop = top;
            this._cardLayer.style = `padding-top: ${top}px;`;
        }
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
