import type { AgentInput } from '@linkcode/schema';
import { BaseAgentAdapter } from './adapter';

/** Pi SDK adapter (stub). ❓ What "Pi SDK" refers to specifically, and its integration form, are to be confirmed (PLAN §10.3). */
export class PiAdapter extends BaseAgentAdapter {
  readonly kind = 'pi' as const;

  send(input: AgentInput): Promise<void> {
    // TODO: Integrate the Pi SDK and normalize its native events into AgentEvent.
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
