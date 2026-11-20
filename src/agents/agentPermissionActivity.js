import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {createButton} from '../ui/button.js';
import {LiveActivity} from '../ui/liveActivity.js';

/**
 * A background Claude Code task asks before it edits a file or runs a command: the capsule shows what it wants, with
 * Deny / Always (in this task) / Allow. The question stays until it is answered (here, in the quick panel or in the
 * agents window); the card goes away by itself once it is answered anywhere.
 */
export class AgentPermissionActivity extends LiveActivity {
    /** @param {{request: object, agents: AgentsService, onDismiss: () => void}} params */
    constructor({request, agents, onDismiss}) {
        super({id: `agent-ask-${request.requestId}`, widgetId: 'agents'});
        this._request = request;
        this._agents = agents;
        this._dismissed = false;
        this._onDismiss = () => {
            if (this._dismissed)
                return;
            this._dismissed = true;
            onDismiss();
        };
        // answered somewhere else (or the task stopped): the card is not needed any more. The event comes before the
        // state that lists the question, so only a question once seen in the state can be gone from it.
        let seen = false;
        agents.connectObject('changed', () => {
            const task = agents.task(request.id);
            const asking = !!task?.pending?.some(p => p.requestId === request.requestId);
            if (asking)
                seen = true;
            else if (seen || (task && !task.running))
                this._onDismiss();
        }, this);
    }

    get title() {
        return `Claude · ${this._request.project}`;
    }

    get peekSize() {
        return {width: 360, height: 150};
    }

    createCompactParts() {
        throw new Error('The agent question has no compact face');
    }

    _answer(decision) {
        this._agents.answer(this._request.id, this._request.requestId, decision).catch(() => {});
        this._onDismiss();
    }

    createPeekView() {
        const r = this._request;
        const root = new St.BoxLayout({vertical: true, style_class: 'osmin-ls osmin-agent-card', x_expand: true, y_expand: true});
        const header = new St.BoxLayout({style_class: 'osmin-ls-header'});
        header.add_child(new St.Icon({icon_name: 'dialog-question-symbolic', style_class: 'osmin-agent-card-icon', y_align: Clutter.ActorAlign.CENTER}));
        const title = new St.Label({text: `Claude · ${r.project}`, style_class: 'osmin-ls-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        header.add_child(title);
        const open = createButton({iconName: 'view-reveal-symbolic', styleClass: 'osmin-mirror-control', onClick: () => {
            this._agents.openWindow({id: r.id});
            this._onDismiss();
        }});
        open.y_align = Clutter.ActorAlign.CENTER;
        header.add_child(open);
        root.add_child(header);

        const body = new St.BoxLayout({vertical: true, x_expand: true, y_expand: true, style_class: 'osmin-ls-progress'});
        body.add_child(new St.Label({text: `wants to: ${r.verb}`, style_class: 'osmin-ls-status'}));
        if (r.detail) {
            const detail = new St.Label({text: r.detail, style_class: 'osmin-agent-card-detail'});
            detail.clutter_text.ellipsize = Pango.EllipsizeMode.MIDDLE;
            body.add_child(detail);
        }
        const buttons = new St.BoxLayout({style_class: 'osmin-ls-buttons', x_align: Clutter.ActorAlign.CENTER, y_expand: true, y_align: Clutter.ActorAlign.END});
        buttons.add_child(createButton({label: 'Deny', styleClass: 'osmin-ls-cancel', onClick: () => this._answer('deny')}));
        buttons.add_child(createButton({label: 'Always', styleClass: 'osmin-ls-cancel', onClick: () => this._answer('always')}));
        buttons.add_child(createButton({label: 'Allow', styleClass: 'osmin-ls-cancel osmin-ls-accept', onClick: () => this._answer('allow')}));
        body.add_child(buttons);
        root.add_child(body);
        return root;
    }

    destroy() {
        this._agents.disconnectObject(this);
    }
}
