import type { AgentInput } from '@linkcode/schema';
import { BaseAgentAdapter } from './adapter';

/** Claude Code adapter（桩）。❓ 接入形态待确认（PLAN §10.3）。 */
export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly kind = 'claude-code' as const;

  send(input: AgentInput): Promise<void> {
    // TODO: 接入 Claude Code SDK，将其原生事件归一化为 AgentEvent。
    switch (input.type) {
      case 'user-message':
        this.echo(input.text);
        break;
      case 'interrupt':
        this.emit({ type: 'status', status: 'idle' });
        break;
      case 'tool-approval':
        // TODO: 工具授权回传（待 Server perm 模型确认，PLAN §10.7）。
        break;
    }
    return Promise.resolve();
  }
}
