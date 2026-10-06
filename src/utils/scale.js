import St from 'gi://St';

/** The shell UI scale factor (actor sizes set from code are not scaled by CSS). */
export function getScaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

export function scaled(px) {
    return Math.round(px * getScaleFactor());
}
