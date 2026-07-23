import type { WireMessage } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { AgentRequestHandler } from '../agent/request-handler';
import type { ManagedAssetService } from '../asset/service';
import type { AutomationRequestHandler } from '../automation/request-handler';
import type { GitRequestHandler } from '../git/request-handler';
import { observeRequest } from '../observability';
import type { ArtifactRequestHandler } from '../preview/request-handler';
import type { ScriptRequestHandler } from '../scripts/request-handler';
import type { HistoryRequestHandler } from '../session/history-request-handler';
import type { SessionRequestHandler } from '../session/request-handler';
import type { TerminalRequestHandler } from '../terminal/request-handler';
import type { FileRequestHandler } from '../workspace/file-request-handler';
import type { WorkspaceRequestHandler } from '../workspace/request-handler';

interface RequestHandlers {
  readonly session: SessionRequestHandler;
  readonly history: HistoryRequestHandler;
  readonly agent: AgentRequestHandler;
  readonly asset: ManagedAssetService;
  readonly workspace: WorkspaceRequestHandler;
  readonly git: GitRequestHandler;
  readonly file: FileRequestHandler;
  readonly script: ScriptRequestHandler;
  readonly artifact: ArtifactRequestHandler;
  readonly automation: AutomationRequestHandler;
  readonly terminal: TerminalRequestHandler;
}

export class WireRequestRouter {
  constructor(
    private readonly transport: Transport,
    private readonly handlers: RequestHandlers,
  ) {}

  handle(msg: WireMessage): Effect.Effect<void, unknown> {
    const p = msg.payload;
    const routed = this.route(msg);
    // Terminal input and acknowledgement are data-plane hot paths, not control-plane requests.
    if (p.kind === 'terminal.input' || p.kind === 'terminal.ack') return routed;
    const clientReqId = 'clientReqId' in p ? p.clientReqId : undefined;
    return observeRequest(routed, p.kind, {
      kind: p.kind,
      ...(clientReqId && { clientReqId }),
    });
  }

  private route(msg: WireMessage): Effect.Effect<void, unknown> {
    const p = msg.payload;
    switch (p.kind) {
      case 'session.start':
      case 'agent.input':
      case 'session.stop':
      case 'session.delete':
      case 'session.list':
      case 'session.resume':
      case 'session.import':
      case 'session.attach':
      case 'session.detach': {
        return this.handlers.session.handle(p);
      }
      case 'history.list':
      case 'history.read':
      case 'history.resume': {
        return this.handlers.history.handle(p);
      }
      case 'agent-runtime.list':
      case 'agent.catalog':
      case 'plugin.catalog.get':
      case 'config.get':
      case 'config.set': {
        return this.handlers.agent.handle(p);
      }
      case 'asset.list':
      case 'asset.ensure': {
        return this.handlers.asset.handle(p);
      }
      case 'workspace.list':
      case 'workspace.register':
      case 'workspace.update':
      case 'workspace.archive': {
        return this.handlers.workspace.handle(p);
      }
      case 'git.status.get':
      case 'git.pr_status.get':
      case 'git.diff.get': {
        return this.handlers.git.handle(p);
      }
      case 'file.read':
      case 'file.list':
      case 'file.suggest':
      case 'file.host': {
        return this.handlers.file.handle(p);
      }
      case 'script.list':
      case 'script.start':
      case 'script.stop': {
        return this.handlers.script.handle(p);
      }
      case 'artifact.host':
      case 'artifact.revoke': {
        return this.handlers.artifact.handle(p);
      }
      case 'schedule.create':
      case 'schedule.update':
      case 'schedule.delete':
      case 'schedule.pause':
      case 'schedule.resume':
      case 'schedule.run-once':
      case 'schedule.list':
      case 'schedule.runs.list':
      case 'loop.start':
      case 'loop.stop':
      case 'loop.delete':
      case 'loop.list':
      case 'loop.inspect': {
        return this.handlers.automation.handle(p);
      }
      case 'terminal.open':
      case 'terminal.list':
      case 'terminal.attach':
      case 'terminal.detach':
      case 'terminal.input':
      case 'terminal.ack':
      case 'terminal.resize':
      case 'terminal.close': {
        return this.handlers.terminal.handle(p);
      }
      case 'agent-login.start':
      case 'agent-login.submit-code':
      case 'agent-login.cancel': {
        return this.handlers.agent.handle(p);
      }
      case 'ping': {
        return Effect.sync(() => this.transport.send(createWireMessage({ kind: 'pong' })));
      }
      // Downstream-only payloads are ignored here.
      default:
        return Effect.void;
    }
  }
}
