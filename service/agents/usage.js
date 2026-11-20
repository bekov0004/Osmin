import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

/**
 * The Claude plan's limits, as `/usage` in Claude Code shows them: how much of the 5-hour window and of the week is
 * used, and when each starts again.
 *  - While a task runs, Claude Code itself reports them (rate_limit_event in its stream): update().
 *  - Otherwise they are asked from Anthropic (the only server this talks to) with the sign-in Claude Code keeps on this
 *    computer (~/.claude/.credentials.json); nothing else is sent, and the token is not kept or shown anywhere.
 *
 * state: {available, plan, fiveHour: {percent, resetsAt}|null, sevenDay: {percent, resetsAt}|null, updatedAt, problem}
 */
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export class ClaudeUsage {
    constructor(onChange) {
        this._onChange = onChange;
        this._session = new Soup.Session({timeout: 10, user_agent: 'Osmin'});
        this.state = {available: false, plan: '', fiveHour: null, sevenDay: null, updatedAt: 0, problem: ''};
        this._fetching = false;
    }

    _credentials() {
        try {
            const [, bytes] = GLib.file_get_contents(`${GLib.get_home_dir()}/.claude/.credentials.json`);
            return JSON.parse(new TextDecoder().decode(bytes))?.claudeAiOauth ?? null;
        } catch (e) {
            return null;
        }
    }

    /** From Claude Code's own rate_limit_event (percent as 0..1, times in seconds). */
    update(info) {
        const windows = info?.unifiedWindows;
        if (!windows)
            return;
        const window = w => (w ? {percent: Math.round((w.utilization ?? 0) * 1000) / 10, resetsAt: (w.resetsAt ?? 0) * 1000} : null);
        this.state = {
            ...this.state, available: true,
            fiveHour: window(windows.five_hour) ?? this.state.fiveHour,
            sevenDay: window(windows.seven_day) ?? this.state.sevenDay,
            updatedAt: Date.now(), problem: '',
        };
        this._onChange();
    }

    /** Asks Anthropic (at most once a minute). */
    async refresh({force = false} = {}) {
        if (this._fetching || (!force && Date.now() - this.state.updatedAt < 60000))
            return;
        const credentials = this._credentials();
        if (!credentials?.accessToken) {
            this.state = {...this.state, available: false, problem: 'Sign in to Claude Code once to see the plan limits'};
            this._onChange();
            return;
        }
        this.state.plan = credentials.subscriptionType ?? this.state.plan;
        if (credentials.expiresAt && credentials.expiresAt < Date.now()) {
            // Claude Code renews its sign-in when it next runs; until then the last numbers stay
            this.state = {...this.state, problem: 'Limits update the next time Claude Code runs'};
            this._onChange();
            return;
        }
        this._fetching = true;
        try {
            const message = Soup.Message.new('GET', USAGE_URL);
            message.request_headers.append('Authorization', `Bearer ${credentials.accessToken}`);
            message.request_headers.append('anthropic-beta', 'oauth-2025-04-20');
            const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.get_status() !== 200)
                throw new Error(`HTTP ${message.get_status()}`);
            const data = JSON.parse(new TextDecoder().decode(bytes.toArray()));
            const window = w => (w ? {percent: Number(w.utilization ?? 0), resetsAt: Date.parse(w.resets_at ?? '') || 0} : null);
            this.state = {
                available: true, plan: credentials.subscriptionType ?? '',
                fiveHour: window(data.five_hour), sevenDay: window(data.seven_day),
                updatedAt: Date.now(), problem: '',
            };
        } catch (e) {
            this.state = {...this.state, problem: `Could not get the limits (${e.message})`};
        } finally {
            this._fetching = false;
        }
        this._onChange();
    }
}
