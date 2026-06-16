import type { AgentInput } from '@linkcode/schema';
import { BaseAgentAdapter } from './adapter';

/** OpenCode adapter（桩）。❓ 接入形态待确认（PLAN §10.3）。 */
export class OpenCodeAdapter extends BaseAgentAdapter {
  readonly kind = 'opencode' as const;

  send(input: AgentInput): Promise<void> {
    // TODO: 接入 OpenCode SDK，将其原生事件归一化为 AgentEvent。
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
