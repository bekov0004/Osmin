import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

/** Chip showing "Workspace <active> / <total>". */
export class WorkspaceChip extends St.BoxLayout {
    static {
        GObject.registerClass({GTypeName: 'OsminWorkspaceChip'}, this);
    }

    constructor() {
        super({style_class: 'osmin-workspace'});
        this.add_child(new St.Icon({
            icon_name: 'view-grid-symbolic',
            style_class: 'osmin-workspace-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._value = new St.Label({
            style_class: 'osmin-workspace-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._value);
    }

    update({index, total}) {
        this._value.text = `${index} / ${total}`;
    }
}
