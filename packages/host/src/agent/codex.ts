import type { AgentInput } from '@linkcode/schema';
import { BaseAgentAdapter } from './adapter';

/** CodeX adapter（桩）。❓ 接入形态待确认（PLAN §10.3）。 */
export class CodexAdapter extends BaseAgentAdapter {
  readonly kind = 'codex' as const;

  send(input: AgentInput): Promise<void> {
    // TODO: 接入 CodeX SDK，将其原生事件归一化为 AgentEvent。
    switch (input.type) {
      case 'user-message':
        this.echo(input.text);
        break;
      case 'interrupt':
        this.emit({ type: 'status', status: 'idle' });
        break;
      case 'tool-approval':
        break;
    }
    return Promise.resolve();
  }
}
