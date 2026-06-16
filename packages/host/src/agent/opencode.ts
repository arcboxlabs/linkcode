import type { AgentInput } from '@linkcode/schema';
import { BaseAgentAdapter } from './adapter';

/** OpenCode adapter (stub). ❓ Integration form to be confirmed (PLAN §10.3). */
export class OpenCodeAdapter extends BaseAgentAdapter {
  readonly kind = 'opencode' as const;

  send(input: AgentInput): Promise<void> {
    // TODO: Integrate the OpenCode SDK and normalize its native events into AgentEvent.
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
