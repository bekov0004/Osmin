import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {formatTime} from 'resource:///org/gnome/shell/misc/dateUtils.js';

import {CardManager} from './services/cardManager.js';
import {CalendarService} from './services/calendarService.js';
import {CameraService} from './services/cameraService.js';
import {ClockService} from './services/clockService.js';
import {DragService} from './services/dragService.js';
import {FileService} from './services/fileService.js';
import {ActivityManager} from './services/activityManager.js';
import {ArtworkService} from './services/artworkService.js';
import {EventManager} from './services/eventManager.js';
import {MediaService} from './services/mediaService.js';
import {TimerService} from './services/timerService.js';
import {TodoService} from './services/todoService.js';
import {PanelService} from './services/panelService.js';
import {ClosedView} from './ui/closedView.js';
import {DropView} from './ui/dropView.js';
import {OsminPanel} from './ui/osminPanel.js';
import {cardClassFor, createCard} from './ui/cardFactory.js';
import {WIDGET_CLASSES} from './widgets/registry.js';
import {animDuration, fadeIn, fadeOut} from './utils/animation.js';
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

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * The capsule that replaces the GNOME clock in the top bar.
 *
 * One actor morphs between four states: CLOSED (the time), HOVER (slightly
 * swollen, about to open), OPEN (wide, with sections) and CARD (an event
 * card). Its top edge never moves; x, width and height are animated.
 *
 *   EventManager --events--> CardManager --host calls--> Osmin --> OsminCard
 *
 * Osmin is also the "host" of the CardManager: it renders cards and animates
 * the capsule around them.
 */
export class Osmin {
    constructor() {
        this._state = null;
        this._signals = new SignalTracker();
        this._timers = new Timers();
        this._actor = null;
        this._cardWidget = null;
        this._cardSize = null;
        this._cardToken = 0;
        this._resumeOpen = false;
        this._target = null;
        this._lastInteraction = 0;
        this._pinned = false;
        this._dragUris = null;
        this._dragArmed = false;
        this._compactActivity = null;
        this._openPage = null;
        this._destroying = false;
        this._grab = null;
        this._onTextInputEnd = null;
        this._scrollAccumulator = 0;
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
            if (this._state !== State.OPEN && event.type !== EventType.ACTIVITY)
                this._closedView.setActivity(true);
        });

        this._services = {
            media: new MediaService(),
            artwork: new ArtworkService(),
            files: new FileService(),
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
        this._widgets = WIDGET_CLASSES.map(WidgetClass => new WidgetClass({
            events: this._events,
            services: this._services,
            ui: {
                beginTextInput: onEnd => this._beginTextInput(onEnd),
                endTextInput: () => this._endTextInput(),
            },
        }));
        this._buildActor();
        this._panel.enable();
        Main.layoutManager.addChrome(this._actor, {trackFullscreen: true});

        this._signals.connect(St.ThemeContext.get_for_stage(global.stage),
            'notify::scale-factor', () => this._relayout());

        this._services.activities.connectObject(
            'ongoing-changed', () => this._syncCompact(),
            'compact-resized', () => this._onCompactResized(),
            this);
        this._widgets.forEach(widget => widget.start());
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
        this._services?.activities.disconnectObject(this);
        this._endTextInput();
        this._timers.destroy();
        this._signals.disconnectAll();
        this._unsubscribe?.();
        this._cards?.destroy();
        this._events?.destroy();
        this._clock?.destroy();
        this._widgets?.forEach(widget => widget.destroy());
        this._widgets = null;
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
            delay: alreadyCard ? 30 : 80,
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
        this._dropView = new DropView();
        this._cardLayer = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this._panelView = new OsminPanel({
            widgets: this._widgets,
            onClose: () => this.close(),
        });
        // CLOSED and HOVER share one view: only the capsule size differs.
        this._views = {
            [State.CLOSED]: this._closedView,
            [State.HOVER]: this._closedView,
            [State.OPEN]: this._panelView,
            [State.CARD]: this._cardLayer,
            [State.DROP]: this._dropView,
        };
        for (const view of new Set(Object.values(this._views))) {
            view.opacity = 0;
            view.hide();
            this._content.add_child(view);
        }

        // The shell may destroy the actor first (at shutdown): stop touching it then.
        this._actor.connect('destroy', () => {
            this._destroying = true;
            this._actor = null;
        });
        this._actor.connect('notify::hover', () => this._onHoverChanged());
        this._actor.connect('clicked', () => this._onClicked());
        // Middle click on the collapsed capsule: the next ongoing activity.
        this._actor.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === Clutter.BUTTON_MIDDLE &&
                (this._state === State.CLOSED || this._state === State.HOVER) &&
                this._services.activities.cycle(1)) {
                this._timers.clear('dwell'); // the user is flipping through, not opening
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
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
        this._dragArmed = false;
        this._dropView.setCount(uris.length);
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
            this._dragArmed = false;
            this._setState(State.CLOSED);
        }

        if (this._state === State.DROP && this._target) {
            const margin = scaled(Layout.DROP_ARM_MARGIN);
            const t = this._target;
            this._dragArmed = x >= t.x - margin && x <= t.x + t.width + margin &&
                y >= t.y - margin && y <= t.y + t.height + margin;
            this._dropView.setArmed(this._dragArmed);
        }
    }

    async _onDragEnded({dropped, uris}) {
        const armed = this._dragArmed;
        this._dragUris = null;
        this._dragArmed = false;
        this._dropView.setArmed(false);

        // The files widget shows the "Adding / Added" activity.
        if (dropped && armed)
            await this._services.files.add(uris);
        if (this._state === State.DROP)
            this._setState(State.CLOSED);
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

    _onHoverChanged() {
        const hovered = this._actor.hover;
        this._timers.clear('hover');

        switch (this._state) {
        case State.CLOSED:
            // Brushing the top bar must not open anything: rest first, then swell, then open.
            if (hovered) {
                this._timers.set('hover', HOVER_INTENT_MS, () => {
                    this._setState(State.HOVER);
                    this._timers.set('dwell', OPEN_DWELL_MS, () => this._setState(State.OPEN));
                });
            }
            break;
        case State.HOVER:
            if (hovered) {
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
            } else if (!this._pinned && !this._grab) {
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
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
        case Clutter.ScrollDirection.LEFT:
            step = -1;
            break;
        case Clutter.ScrollDirection.DOWN:
        case Clutter.ScrollDirection.RIGHT:
            step = 1;
            break;
        case Clutter.ScrollDirection.SMOOTH: {
            const [dx, dy] = event.get_scroll_delta();
            this._scrollAccumulator += Math.abs(dx) > Math.abs(dy) ? dx : dy;
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
        if (step === 0 || this._timers.has('scroll-lock'))
            return Clutter.EVENT_STOP;

        this._scrollAccumulator = 0;
        this._timers.set('scroll-lock', SCROLL_LOCK_MS, () => {});
        if (this._state === State.OPEN)
            this._panelView.showPage(this._panelView.pageIndex + step);
        else
            this._services.activities.cycle(step);
        return Clutter.EVENT_STOP;
    }

    /** Shows the ongoing activity with the highest priority in the collapsed capsule. */
    _syncCompact() {
        if (this._destroying || !this._actor)
            return;
        const activity = this._services.activities.compact;
        if (activity === this._compactActivity)
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

        if (previous !== State.CARD && state !== State.CARD)
            this._resumeOpen = false;
        if (previous === State.CARD) {
            this._cards.resume();
            this._cardSize = null;
        }

        // Fade the old view out quickly and the new one in once the capsule has
        // started to grow. The card layer is not faded: the cards fade themselves.
        const previousView = previous ? this._views[previous] : null;
        const nextView = this._views[state];
        if (previousView && previousView !== nextView)
            fadeOut(previousView, {duration: 80});
        if (previousView !== nextView) {
            if (animate && state !== State.CARD) {
                fadeIn(nextView, {duration: 170, delay: state === State.CLOSED ? 70 : 90});
            } else {
                nextView.remove_all_transitions();
                nextView.show();
                nextView.opacity = 255;
            }
        }

        if (previous === State.OPEN) {
            this._endTextInput();
            this._panelView.setOpen(false);
        }
        if (state === State.OPEN) {
            // Open on the widget of the ongoing activity (or the one that was clicked).
            const page = this._openPage ?? this._compactActivity?.widgetId;
            this._openPage = null;
            if (page)
                this._panelView.showWidget(page);
            this._panelView.setOpen(true);
            this._closedView.setActivity(false);
            if (!this._actor.hover && !this._pinned)
                this._timers.set('leave', OPEN_LEAVE_MS, () => this._settle());
        } else {
            this._pinned = false;
        }

        this._applyGeometry(animate ? Motion[state] : {duration: 0});
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

    /** Adapts to the monitor: a share of its width, clamped, never wider than the screen. */
    _openSize(geo) {
        const scale = getScaleFactor();
        const availableCss = geo.monitor.width / scale;
        const widthCss = Math.min(
            clamp(availableCss * Layout.OPEN_WIDTH_RATIO, Layout.OPEN_MIN_WIDTH, Layout.OPEN_MAX_WIDTH),
            availableCss - 2 * Layout.SCREEN_MARGIN);
        const width = Math.round(widthCss * scale);
        this._panelView.setWidth(width);
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
            return this._openSize(geo);
        case State.DROP:
            return {width: scaled(Layout.DROP_WIDTH), height: scaled(Layout.DROP_HEIGHT)};
        case State.CARD:
            if (this._cardSize) {
                return {
                    width: scaled(this._cardSize.width),
                    height: scaled(this._cardSize.height),
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
        // The top edge is the same in every state: the capsule only grows downwards.
        return {x, y: geo.top + scaled(Layout.PANEL_INSET), ...size};
    }

    _applyGeometry({duration, mode = Clutter.AnimationMode.EASE_OUT_CUBIC}) {
        this._syncAnchor();
        this._target = this._geometryFor(this._state);
        this._actor.ease({
            ...this._target,
            duration: animDuration(duration),
            mode,
        });
    }

    /** Keeps the empty spot in the top bar as wide as the collapsed capsule. */
    _syncAnchor() {
        if (!this._actor)
            return;
        this._panel.setAnchorWidth(this._closedSize(this._panel.getGeometry()).width);
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
    }
}
