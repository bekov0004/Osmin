import Gio from 'gi://Gio';

import {Module} from '../module.js';

/** Small jobs that touch the disk. rpc_emptyTrash() -> {count} */
export class ToolsModule extends Module {
    constructor() {
        super('Tools');
    }

    async rpc_emptyTrash() {
        const trash = Gio.File.new_for_uri('trash:///');
        let count = 0;
        const remove = file => {
            const info = file.query_info('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                const children = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
                for (let child = children.next_file(null); child; child = children.next_file(null))
                    remove(file.get_child(child.get_name()));
            }
            file.delete(null);
        };
        const children = trash.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        for (let info = children.next_file(null); info; info = children.next_file(null)) {
            try {
                remove(trash.get_child(info.get_name()));
                count++;
            } catch (e) {
                console.warn(`[osmin-service] cannot remove ${info.get_name()} from the trash: ${e.message}`);
            }
        }
        return {count};
    }
}
