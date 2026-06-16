import type { AgentInput } from '@linkcode/schema';
import { BaseAgentAdapter } from './adapter';

/** Pi SDK adapter（桩）。❓ 「Pi SDK」具体所指与接入形态待确认（PLAN §10.3）。 */
export class PiAdapter extends BaseAgentAdapter {
  readonly kind = 'pi' as const;

  send(input: AgentInput): Promise<void> {
    // TODO: 接入 Pi SDK，将其原生事件归一化为 AgentEvent。
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
