import type { AgentInput } from '@linkcode/schema';
import { BaseAgentAdapter } from './adapter';

/** Claude Code adapter (stub). ❓ Integration form to be confirmed (PLAN §10.3). */
export class ClaudeCodeAdapter extends BaseAgentAdapter {
  readonly kind = 'claude-code' as const;

  send(input: AgentInput): Promise<void> {
    // TODO: Integrate the Claude Code SDK and normalize its native events into AgentEvent.
    switch (input.type) {
      case 'user-message':
        this.echo(input.text);
        break;
      case 'interrupt':
        this.emit({ type: 'status', status: 'idle' });
        break;
      case 'tool-approval':
        // TODO: Tool-approval response (pending confirmation of the Server perm model, PLAN §10.7).
        break;
    }
    return Promise.resolve();
  }
}
