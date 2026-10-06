import Clutter from 'gi://Clutter';
import St from 'gi://St';

/** A flat button with an optional symbolic icon and label. */
export function createButton({label = null, iconName = null, styleClass = '', onClick}) {
    const button = new St.Button({
        style_class: `osmin-button ${styleClass}`.trim(),
        reactive: true,
        can_focus: true,
        track_hover: true,
        button_mask: St.ButtonMask.ONE,
        x_expand: false,
    });

    const box = new St.BoxLayout({
        style_class: 'osmin-button-content',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    button.set_child(box);

    if (iconName) {
        box.add_child(new St.Icon({
            icon_name: iconName,
            style_class: 'osmin-button-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
    }
    if (label) {
        box.add_child(new St.Label({
            text: label,
            style_class: 'osmin-button-label',
            y_align: Clutter.ActorAlign.CENTER,
        }));
    }

    button.connect('clicked', () => onClick());
    return button;
}
