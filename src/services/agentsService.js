import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

/**
 * AI agents (Claude Code, Codex) as the widget sees them: a mirror of the Osmin service's numbers
 * (service/agents), which reads the agents' own session logs.
 * Signals: 'changed', 'finished' ({agent, name, project, seconds}).
 */
export class AgentsService extends Signals.EventEmitter {
    /** @param {ModuleClient} module */
    constructor(module) {
        super();
        this._module = module;
        module.connect('state-changed', () => this.emit('changed'));
        module.connect('event', (_m, name, payload) => {
            if (name === 'finished')
                this.emit('finished', payload);
        });
    }

    /** [{id, name, installed, working: [{project, since}], tokens5h, tokens7d, messages5h, last}] */
    get agents() {
        return this._module.state.agents ?? [];
    }

    destroy() {}
}
