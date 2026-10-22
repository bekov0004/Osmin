/**
 * How many px taller a scrolling list is than its viewport (<= 0: it all fits), or null while the
 * viewport has no size yet (not on screen); 0 for a list that is hidden (empty).
 * @param {St.ScrollView} scroll
 * @param {St.Widget} list the scroll view's child
 */
export function listOverflow(scroll, list) {
    if (!scroll.visible)
        return 0;
    if (scroll.height <= 0 || scroll.width <= 0)
        return null;
    return Math.round(list.get_preferred_height(scroll.width)[1] - scroll.height);
}
