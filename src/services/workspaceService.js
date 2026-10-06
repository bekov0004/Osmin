import {SignalTracker} from '../utils/signals.js';

/** Reports the active workspace index and the workspace count. */
export class WorkspaceService {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._signals = new SignalTracker();

        const manager = global.workspace_manager;
        for (const name of ['active-workspace-changed', 'workspace-added', 'workspace-removed'])
            this._signals.connect(manager, name, () => this._onChanged(this.getInfo()));
    }

    getInfo() {
        const manager = global.workspace_manager;
        return {
            index: manager.get_active_workspace_index() + 1,
            total: manager.get_n_workspaces(),
        };
    }

    destroy() {
        this._signals.disconnectAll();
    }
}
