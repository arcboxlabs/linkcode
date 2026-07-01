import type { AgentKind } from '@linkcode/schema';
import { never } from 'foxts/guard';
import type { AgentAdapter } from './adapter';
import { ClaudeCodeAdapter } from './native/claude-code';
import { CodexAdapter } from './native/codex';
import { OpenCodeAdapter } from './native/opencode';
import { PiAdapter } from './native/pi';

/**
 * Adapter factory: instantiate the native adapter for a given agent kind. Each adapter lazy-loads its SDK
 * in `start()`, so a missing SDK degrades to a clear error event rather than breaking the daemon
 * (PLAN §2.5 / §9). Per-session parameters (cwd / model / config) are passed via `StartOptions` to `start()`.
 */
export function createAdapter(kind: AgentKind): AgentAdapter {
  switch (kind) {
    case 'claude-code':
      return new ClaudeCodeAdapter();
    case 'codex':
      return new CodexAdapter();
    case 'opencode':
      return new OpenCodeAdapter();
    case 'pi':
      return new PiAdapter();
    default:
      return never(kind, 'agent kind');
  }
}

export type AdapterFactory = typeof createAdapter;
