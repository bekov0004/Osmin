import Gettext from 'gettext';

/**
 * The translations of the settings. In the Extensions app the extension's text domain is bound by GNOME; in the Osmin
 * app it is not, and the English text is shown as it is.
 */
const domain = Gettext.domain('osmin@osmin.dev');

export const gettext = text => domain.gettext(text);

// "Version %s".format(…): GNOME Shell and the Extensions app add String.prototype.format; the Osmin app does it here
// (%s, %d, %%).
if (typeof String.prototype.format !== 'function') {
    // eslint-disable-next-line no-extend-native
    String.prototype.format = function (...args) {
        let i = 0;
        return this.replace(/%(%|s|d)/g, (_m, kind) => {
            if (kind === '%')
                return '%';
            const value = args[i++];
            return kind === 'd' ? String(Math.trunc(Number(value))) : String(value);
        });
    };
}
