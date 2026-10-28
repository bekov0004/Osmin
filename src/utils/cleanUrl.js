// Parameters that only say where a link was shared from or who clicked it: they change nothing on
// the page. (A link is only changed when it is the whole text.)
const TRACKING = /^(utm_[a-z0-9_]+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|vero_id|ref_src|ref_url|spm|share_id|si)$/i;

/**
 * Removes the tracking parameters of a link.
 * @param {string} text what was copied
 * @returns {string} the cleaned link, or `text` itself when it is not a link or has nothing to remove
 */
export function cleanUrl(text) {
    const trimmed = text.trim();
    if (!/^https?:\/\/\S+$/.test(trimmed))
        return text;
    const hashAt = trimmed.indexOf('#');
    const fragment = hashAt >= 0 ? trimmed.slice(hashAt) : '';
    const withoutFragment = hashAt >= 0 ? trimmed.slice(0, hashAt) : trimmed;
    const questionAt = withoutFragment.indexOf('?');
    if (questionAt < 0)
        return text;
    const base = withoutFragment.slice(0, questionAt);
    const parameters = withoutFragment.slice(questionAt + 1).split('&').filter(Boolean);
    const kept = parameters.filter(parameter => !TRACKING.test(parameter.split('=')[0]));
    if (kept.length === parameters.length)
        return text;
    return `${base}${kept.length > 0 ? `?${kept.join('&')}` : ''}${fragment}`;
}
