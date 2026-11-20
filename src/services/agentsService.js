import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

/**
 * AI agents as the shell sees them: a mirror of the Osmin service (service/agents), which follows Claude Code and
 * Codex through their session logs, runs Claude Code tasks in the background, and knows the plan's limits.
 * Signals: 'changed'; 'finished' ({agent, name, project, seconds}): a session seen in the logs went quiet;
 * 'permission' ({id, project, requestId, tool, verb, detail, description}): a background task asks;
 * 'task-finished' ({id, project, ok, text, costUsd}).
 */
export class AgentsService extends Signals.EventEmitter {
    /** @param {ModuleClient} module */
    constructor(module) {
        super();
        this._module = module;
        module.connect('state-changed', () => this.emit('changed'));
        module.connect('event', (_m, name, payload) => {
            if (name === 'finished' || name === 'permission' || name === 'task-finished')
                this.emit(name, payload);
        });
    }

    get _state() {
        return this._module.state ?? {};
    }

    /** [{id, name, installed, working: [{project, since}], tokens5h, tokens7d, messages5h, last}] */
    get agents() {
        return this._state.agents ?? [];
    }

    /** Background tasks, newest first: [{id, project, cwd, prompt, status, current, running, pending, costUsd, ...}] */
    get tasks() {
        return this._state.tasks ?? [];
    }

    /** {available, plan, fiveHour: {percent, resetsAt}, sevenDay: {percent, resetsAt}, problem} */
    get usage() {
        return this._state.usage ?? {available: false};
    }

    /** Recent project folders: [{path, name, last}] */
    get projects() {
        return this._state.projects ?? [];
    }

    get claudeInstalled() {
        return !!this._state.claude;
    }

    get codexInstalled() {
        return !!this._state.codex;
    }

    task(id) {
        return this.tasks.find(t => t.id === id) ?? null;
    }

    /** @returns {Promise<{id?: string, terminal?: string}>} */
    startTask({cwd, prompt, where = 'background', model = '', agent = 'claude'}) {
        return this._module.call('startTask', {cwd, prompt, where, model, agent});
    }

    send(id, text) {
        return this._module.call('send', {id, text});
    }

    /** @param {'allow'|'always'|'deny'} decision */
    answer(id, requestId, decision) {
        return this._module.call('answer', {id, requestId, decision});
    }

    interrupt(id) {
        return this._module.call('interrupt', {id});
    }

    stop(id) {
        return this._module.call('stop', {id});
    }

    remove(id) {
        return this._module.call('remove', {id});
    }

    refreshUsage() {
        return this._module.call('refreshUsage', {}).catch(() => {});
    }

    /** The agents window of the Osmin app: a task (id), a new task, or the list. */
    openWindow({id = '', newTask = false} = {}) {
        return this._module.call('openWindow', {id, newTask}).catch(() => {});
    }

    destroy() {}
}
