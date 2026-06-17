import type { AgentInput } from '@linkcode/schema';
import { BaseAgentAdapter } from './adapter';

/** CodeX adapter (stub). ❓ Integration form to be confirmed (PLAN §10.3). */
export class CodexAdapter extends BaseAgentAdapter {
  readonly kind = 'codex' as const;

  send(input: AgentInput): Promise<void> {
    // TODO: Integrate the CodeX SDK and normalize its native events into AgentEvent.
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
