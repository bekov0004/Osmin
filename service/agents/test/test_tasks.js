// gjs -m service/agents/test/test_tasks.js  — the agents module with a fake Claude Code
import GLib from 'gi://GLib';
import {AgentsModule} from '../module.js';
const here = GLib.path_get_dirname(import.meta.url.replace('file://', ''));
GLib.setenv('OSMIN_CLAUDE_BIN', `${here}/fake_claude.py`, true);

const loop = new GLib.MainLoop(null, false);
const module = new AgentsModule(null);
const events = [];
module.emitEvent = (name, payload) => events.push([name, payload]);
module.emitState = () => {};
const assert = (ok, what) => {
    if (!ok) {
        print(`FAIL: ${what}`);
        print(JSON.stringify(events));
        loop.quit();
        throw new Error(what);
    }
};
const wait = (cond, ms = 4000) => new Promise((resolve, reject) => {
    const start = Date.now();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
        if (cond()) {
            resolve();
            return GLib.SOURCE_REMOVE;
        }
        if (Date.now() - start > ms) {
            reject(new Error('timeout'));
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
});

(async () => {
    try {
        const tmp = GLib.dir_make_tmp('osmin-agents-XXXXXX');
        const {id} = await module.dispatch('startTask', {cwd: tmp, prompt: 'make a.txt'});
        const task = module.task(id);
        await wait(() => events.some(e => e[0] === 'permission'));
        const permission = events.find(e => e[0] === 'permission')[1];
        assert(permission.verb === 'Writing' && permission.tool === 'Write', 'the permission says what');
        assert(task.status === 'waiting', 'waiting for the answer');
        assert(module.state.usage.fiveHour?.percent === 31, 'limits from the stream');
        await module.dispatch('answer', {id, requestId: permission.requestId, decision: 'always'});
        await wait(() => task.status === 'idle');
        assert(events.some(e => e[0] === 'task-finished' && e[1].ok), 'finished event');
        assert(task.costUsd > 0.009 && task.tokens === 15, 'cost and tokens');
        const kinds = task.transcript.map(e => e.kind).join(',');
        assert(kinds === 'user,text,tool,note,text,result', `transcript ${kinds}`);
        assert(task.transcript[2].ok === true && task.transcript[2].output === 'written', 'tool result joined');
        // more to do, in the same process
        await module.dispatch('send', {id, text: 'again'});
        await wait(() => events.filter(e => e[0] === 'permission').length === 2);
        const second = events.filter(e => e[0] === 'permission')[1][1];
        await module.dispatch('answer', {id, requestId: second.requestId, decision: 'deny'});
        await wait(() => task.status === 'idle' && task.transcript.filter(e => e.kind === 'result').length === 2);
        assert(task.transcript.find(e => e.kind === 'tool' && e.ok === false), 'denied tool shown failed');
        assert(Math.abs(task.costUsd - 0.02) < 1e-9, `cost counted once per session: ${task.costUsd}`);
        // interrupt a long step
        await module.dispatch('send', {id, text: 'slow job'});
        await wait(() => task.current.startsWith('Running sleep'));
        await module.dispatch('interrupt', {id});
        await wait(() => task.status === 'failed' || task.status === 'idle');
        // stop: the process ends, status stopped
        await module.dispatch('stop', {id});
        await wait(() => !task.running && task.status === 'stopped');
        // continue a stopped task: --resume with its session
        const session = task.sessionId;
        assert(session, 'session id kept');
        await module.dispatch('send', {id, text: 'continue'});
        await wait(() => task.running);
        await wait(() => events.filter(e => e[0] === 'permission').length === 3);
        const third = events.filter(e => e[0] === 'permission')[2][1];
        await module.dispatch('answer', {id, requestId: third.requestId, decision: 'allow'});
        await wait(() => task.status === 'idle');
        await module.dispatch('stop', {id});
        await wait(() => !task.running);
        const summary = module.state.tasks[0];
        assert(summary.id === id && summary.project.startsWith('osmin-agents'), 'state lists the task');
        // a folder that is not there
        let refused = false;
        try {
            await module.dispatch('startTask', {cwd: '/nowhere/at/all', prompt: 'x'});
        } catch (e) {
            refused = true;
        }
        assert(refused, 'a missing folder is refused');
        print('agents ok');
    } catch (e) {
        print(`ERROR ${e.message}\n${e.stack}`);
    }
    loop.quit();
})();
loop.run();
