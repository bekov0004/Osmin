import Adw from 'gi://Adw';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {OsminPreferences} from './prefsWindow.js';

/** The settings as the Extensions app opens them: the same window as the Osmin app's (prefsWindow.js). */
export default class OsminExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        new OsminPreferences({settings: this.getSettings(), metadata: this.metadata}).fillPreferencesWindow(window);
        // The window shows its own frame (set_content); the Extensions app still wants a page, or it calls the
        // window "Extension Error". This one is never seen.
        window.add(new Adw.PreferencesPage());
        window.title = 'Osmin';
    }
}
