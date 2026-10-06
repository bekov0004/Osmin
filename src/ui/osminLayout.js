import {BASE_CELL_CSS, WIDGET_INFO} from '../utils/widgetInfo.js';

const MIN_TOTAL_CSS = 320;     // never narrower than this
const MAX_SHARE = 0.72;        // never wider than this share of the monitor
const SCREEN_MARGIN_CSS = 24;

/**
 * Works out how big the expanded capsule is and how the widgets sit in it.
 * Everything is in CSS px (the shell multiplies by the UI scale), so it works
 * the same on any resolution and scale factor.
 *
 *   total width = paddings + widget widths + gaps
 *
 * In "auto" width mode every widget gets `cells * cell` px and the capsule
 * grows or shrinks with the number of widgets. If they do not fit on the
 * screen they are split into pages. In "fixed" width mode the capsule is a
 * share of the screen and the widgets share it in proportion to their cells.
 *
 * @param {object} input
 * @param {number} input.monitorCss  monitor width in CSS px
 * @param {string[]} input.widgetIds widgets in display order
 * @param {(id: string) => number} input.cellsFor
 * @param {object} input.settings    SettingsService
 * @returns {{widthCss: number, pages: {id: string, widthCss: number}[][],
 *            gap: number, padding: number, rowHeight: number, dividers: boolean}}
 */
export function computeLayout({monitorCss, widgetIds, cellsFor, settings}) {
    const scale = settings.get('size-scale');
    const gap = settings.get('widget-spacing');
    const padding = settings.get('content-padding');
    const rowHeight = settings.get('row-height');
    const dividers = settings.get('show-dividers');
    const cell = BASE_CELL_CSS * scale;

    const maxTotal = Math.max(MIN_TOTAL_CSS,
        Math.min(monitorCss * MAX_SHARE, monitorCss - 2 * SCREEN_MARGIN_CSS));
    const ids = widgetIds.length > 0 ? widgetIds : [WIDGET_INFO[0].id];

    const natural = id => Math.max(cellsFor(id), 1) * cell;
    const total = list => list.reduce((sum, id) => sum + natural(id), 0) +
        Math.max(list.length - 1, 0) * gap + 2 * padding;

    // Greedy split into pages that each fit in `maxTotal`.
    const pageIds = [];
    let current = [];
    for (const id of ids) {
        if (current.length > 0 && total([...current, id]) > maxTotal) {
            pageIds.push(current);
            current = [];
        }
        current.push(id);
    }
    pageIds.push(current);

    let widthCss;
    if (settings.get('width-mode') === 'fixed') {
        widthCss = Math.max(MIN_TOTAL_CSS, Math.min(monitorCss * settings.get('fixed-width'), maxTotal));
    } else {
        widthCss = Math.max(MIN_TOTAL_CSS, ...pageIds.map(total));
    }
    widthCss = Math.round(Math.min(widthCss, maxTotal));

    // Widget widths on each page: natural in auto mode, stretched to fill otherwise.
    const pages = pageIds.map(list => {
        const inner = widthCss - 2 * padding - Math.max(list.length - 1, 0) * gap;
        const cellsSum = list.reduce((sum, id) => sum + Math.max(cellsFor(id), 1), 0);
        return list.map(id => ({
            id,
            widthCss: Math.floor(inner * Math.max(cellsFor(id), 1) / cellsSum),
        }));
    });

    return {widthCss, pages, gap, padding, rowHeight, dividers};
}
