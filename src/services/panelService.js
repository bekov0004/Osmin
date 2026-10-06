import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import {SignalTracker} from '../utils/signals.js';

const ANCHOR_ROLE = 'osmin-anchor';

/**
 * Takes the place of the GNOME clock in the middle of the top bar.
 *
 *  - hides the date-menu button (and keeps it hidden if the panel re-shows it
 *    on a session-mode change); everything is restored by destroy();
 *  - adds an invisible "anchor" button to the panel's center box, so the
 *    panel reserves the spot and the capsule can follow its exact position;
 *  - routes the "toggle calendar" action (Super+V) to Osmin instead of the
 *    hidden calendar popup.
 *
 * The GNOME notification system itself is not touched.
 */
export class PanelService {
    constructor({onChanged, onToggleRequest}) {
        this._onChanged = onChanged;
        this._onToggleRequest = onToggleRequest;
        this._signals = new SignalTracker();
        this._injections = new InjectionManager();
        this._anchor = null;
        this._dateMenu = null;
        this._wasVisible = true;
        this._anchorWidth = 0;
        this._styled = false;
        this._originalStyle = '';
        this._corners = [];
    }

    enable() {
        this._hideDateMenu();

        this._anchor = new PanelMenu.Button(0.5, 'Osmin', true);
        this._anchor.reactive = false;
        this._anchor.can_focus = false;
        this._anchor.opacity = 0;
        Main.panel.addToStatusArea(ANCHOR_ROLE, this._anchor, 0, 'center');

        this._signals.connect(this._anchor, 'notify::allocation', () => this._onChanged());
        this._signals.connect(Main.layoutManager.panelBox, 'notify::height', () => this._onChanged());
        this._signals.connect(Main.layoutManager, 'monitors-changed', () => this._onChanged());

        const onToggleRequest = this._onToggleRequest;
        this._injections.overrideMethod(Main.panel, 'toggleCalendar', () => function () {
            onToggleRequest();
        });
    }

    /**
     * Gives the top bar its own background: a colour with an opacity (0 is fully
     * transparent, like the macOS menu bar). The shell's own style is put back
     * by destroy(). The rounded black corners of the bar are hidden meanwhile.
     * @param {{color: string, opacity: number}} look  colour as '#rrggbb'
     */
    setBarLook({color, opacity}) {
        const panel = Main.panel;
        if (!this._styled) {
            this._styled = true;
            this._originalStyle = panel.style ?? '';
            this._corners = [panel._leftCorner, panel._rightCorner]
                .filter(corner => corner)
                .map(corner => ({corner, visible: corner.visible}));
        }
        const match = /^#?([0-9a-f]{6})$/i.exec(color ?? '');
        const hex = match ? match[1] : '000000';
        const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
        const alpha = Math.min(Math.max(Number(opacity) || 0, 0), 1);
        panel.set_style(`background-color: rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)}); ` +
            `${this._originalStyle}`);
        for (const {corner} of this._corners)
            corner.hide();
    }

    _restoreBar() {
        if (!this._styled)
            return;
        Main.panel.set_style(this._originalStyle || null);
        for (const {corner, visible} of this._corners) {
            if (visible)
                corner.show();
        }
        this._corners = [];
        this._styled = false;
    }

    destroy() {
        this._restoreBar();
        this._injections.clear();
        this._signals.disconnectAll();
        this._anchor?.destroy();
        this._anchor = null;

        if (this._dateMenu) {
            const container = this._dateMenu.container;
            container.show();
            if (!this._wasVisible)
                container.hide();
            this._dateMenu = null;
        }
    }

    /** Reserves `width` px in the center of the top bar (the collapsed capsule). */
    setAnchorWidth(width) {
        if (this._anchorWidth === width)
            return;
        this._anchorWidth = width;
        this._anchor?.set_width(width);
    }

    /**
     * @returns {{monitor: object, centerX: number, top: number, height: number}}
     *   panel geometry in stage coordinates; centerX is the middle of the
     *   spot where the GNOME clock used to be.
     */
    getGeometry() {
        // The monitor may not exist yet while the shell is still starting up.
        const monitor = Main.layoutManager.primaryMonitor ??
            {x: 0, y: 0, width: global.stage.width || 1920, height: global.stage.height || 1080, index: 0};
        const panelBox = Main.layoutManager.panelBox;

        let centerX = monitor.x + monitor.width / 2;
        if (this._anchor?.mapped && this._anchor.width > 0) {
            // NaN until the panel has allocated the anchor for the first time.
            const [x] = this._anchor.get_transformed_position();
            if (Number.isFinite(x))
                centerX = x + this._anchor.width / 2;
        }
        return {monitor, centerX, top: panelBox.y, height: panelBox.height};
    }

    _hideDateMenu() {
        this._dateMenu = Main.panel.statusArea.dateMenu ?? null;
        if (!this._dateMenu)
            return;

        const container = this._dateMenu.container;
        this._wasVisible = container.visible;
        container.hide();
        // Panel._updatePanel() shows every indicator again on session-mode changes.
        this._signals.connect(container, 'notify::visible', () => {
            if (container.visible)
                container.hide();
        });
    }
}
