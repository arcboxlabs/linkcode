import type { WireMessage } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { AgentRequestHandler } from '../agent/request-handler';
import type { AutomationRequestHandler } from '../automation/request-handler';
import type { GitRequestHandler } from '../git/request-handler';
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

  async handle(msg: WireMessage): Promise<void> {
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
        await this.handlers.session.handle(p);
        break;
      }
      case 'history.list':
      case 'history.read':
      case 'history.resume': {
        await this.handlers.history.handle(p);
        break;
      }
      case 'agent-runtime.list':
      case 'asset.list':
      case 'asset.ensure':
      case 'config.get':
      case 'config.set': {
        await this.handlers.agent.handle(p);
        break;
      }
      case 'workspace.list':
      case 'workspace.register':
      case 'workspace.update':
      case 'workspace.archive': {
        await this.handlers.workspace.handle(p);
        break;
      }
      case 'git.status.get':
      case 'git.pr_status.get':
      case 'git.diff.get': {
        await this.handlers.git.handle(p);
        break;
      }
      case 'file.read':
      case 'file.list':
      case 'file.suggest': {
        await this.handlers.file.handle(p);
        break;
      }
      case 'script.list':
      case 'script.start':
      case 'script.stop': {
        await this.handlers.script.handle(p);
        break;
      }
      case 'artifact.host':
      case 'artifact.revoke': {
        await this.handlers.artifact.handle(p);
        break;
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
        await this.handlers.automation.handle(p);
        break;
      }
      case 'terminal.open':
      case 'terminal.list':
      case 'terminal.attach':
      case 'terminal.detach':
      case 'terminal.input':
      case 'terminal.ack':
      case 'terminal.resize':
      case 'terminal.close': {
        await this.handlers.terminal.handle(p);
        break;
      }
      case 'agent-login.start':
      case 'agent-login.submit-code':
      case 'agent-login.cancel': {
        await this.handlers.agent.handle(p);
        break;
      }
      case 'ping': {
        this.transport.send(createWireMessage({ kind: 'pong' }));
        break;
      }
      // Downstream-only payloads are ignored here.
      default:
        break;
    }
  }
}
