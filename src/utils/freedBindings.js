import Gio from 'gi://Gio';

/**
 * Whatever keys the user gives an Osmin shortcut, they work: when GNOME already uses the same keys (Super+V opens its
 * notification list, for example), Osmin takes them away from GNOME while it runs and gives them back afterwards
 * (when the shortcut is changed, or Osmin is disabled). Nothing is taken that the user did not choose.
 * What was taken is kept in the setting `freed-bindings` ({"schema|key": [the original list]}), so it is given back
 * even after the shell stopped without disabling Osmin.
 */
const SYSTEM_SCHEMAS = [
    'org.gnome.shell.keybindings',
    'org.gnome.desktop.wm.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.mutter.wayland.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
];

const MODIFIER_NAMES = {primary: 'control', ctrl: 'control', control: 'control', shift: 'shift', alt: 'alt', mod1: 'alt', super: 'super', mod4: 'super', meta: 'meta', hyper: 'hyper'};

// The Russian layout (ЙЦУКЕН) on the Latin keys under it: a shortcut recorded with that layout on by an older Osmin
// is "<Super>Cyrillic_em", which works in one layout only. Its key is the one under it in the Latin layout.
const RUSSIAN = {
    shorti: 'q', tse: 'w', u: 'e', ka: 'r', ie: 't', en: 'y', ghe: 'u', sha: 'i', shcha: 'o', ze: 'p', ha: 'bracketleft',
    hardsign: 'bracketright', ef: 'a', yeru: 's', ve: 'd', a: 'f', pe: 'g', er: 'h', o: 'j', el: 'k', de: 'l', zhe: 'semicolon',
    e: 'apostrophe', ya: 'z', che: 'x', es: 'c', em: 'v', i: 'b', te: 'n', softsign: 'm', be: 'comma', yu: 'period', io: 'grave',
};

/** "<Super>Cyrillic_em" -> "<Super>v"; anything else as it is. */
export function latinAccel(accel) {
    return accel.replace(/Cyrillic_([A-Za-z]+)$/, (whole, name) => RUSSIAN[name.toLowerCase()] ?? whole);
}

/** "<Primary><Super>V" and "<Super><Control>v" are the same keys: "control+super+v". */
export function normalizeAccel(accel) {
    if (!accel)
        return '';
    const mods = new Set();
    const rest = accel.replace(/<([^>]+)>/g, (_m, name) => {
        mods.add(MODIFIER_NAMES[name.toLowerCase()] ?? name.toLowerCase());
        return '';
    }).trim().toLowerCase();
    return rest ? [...[...mods].sort(), rest].join('+') : '';
}

/**
 * The new lists of the system's bindings: every binding equal to one of `used` is left out; a binding taken earlier
 * and no longer used is given back. Pure (for the tests).
 * @param {Object<string, string[]>} current   "schema|key" -> its list now
 * @param {Object<string, string[]>} saved     "schema|key" -> its original list (taken earlier)
 * @param {Set<string>} used                   normalized accelerators of Osmin's shortcuts
 * @returns {{set: Object<string, string[]>, saved: Object<string, string[]>}}
 */
export function planFreedBindings(current, saved, used) {
    const set = {};
    const nextSaved = {};
    for (const [id, now] of Object.entries(current)) {
        const original = saved[id] ?? now;
        const kept = original.filter(accel => !used.has(normalizeAccel(accel)));
        if (kept.length !== original.length)
            nextSaved[id] = original;
        const wanted = kept.length !== original.length ? kept : original;
        if (JSON.stringify(wanted) !== JSON.stringify(now))
            set[id] = wanted;
    }
    // taken from a schema that is not installed any more: nothing to give back to
    return {set, saved: nextSaved};
}

function systemSettings() {
    const source = Gio.SettingsSchemaSource.get_default();
    const found = [];
    for (const id of SYSTEM_SCHEMAS) {
        const schema = source?.lookup(id, true);
        if (!schema)
            continue;
        const settings = new Gio.Settings({schema_id: id});
        for (const key of schema.list_keys()) {
            if (schema.get_key(key).get_value_type().dup_string() === 'as')
                found.push({id: `${id}|${key}`, settings, key});
        }
    }
    return found;
}

function readSaved(gsettings) {
    try {
        const value = JSON.parse(gsettings.get_string('freed-bindings') || '{}');
        return value && typeof value === 'object' ? value : {};
    } catch (e) {
        return {};
    }
}

/** Takes from GNOME the keys of these accelerators (and gives back what is no longer used). */
export function syncFreedBindings(gsettings, accels) {
    const used = new Set(accels.map(normalizeAccel).filter(Boolean));
    const entries = systemSettings();
    const current = Object.fromEntries(entries.map(e => [e.id, e.settings.get_strv(e.key)]));
    const {set, saved} = planFreedBindings(current, readSaved(gsettings), used);
    for (const entry of entries) {
        if (set[entry.id])
            entry.settings.set_strv(entry.key, set[entry.id]);
    }
    gsettings.set_string('freed-bindings', JSON.stringify(saved));
}

/** Gives everything back (Osmin is disabled). */
export function restoreFreedBindings(gsettings) {
    syncFreedBindings(gsettings, []);
}
