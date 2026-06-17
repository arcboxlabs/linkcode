import type { AgentKind } from '@linkcode/schema';
import type { AgentAdapter } from './adapter';
import { ClaudeCodeAdapter } from './claude-code';
import { CodexAdapter } from './codex';
import { OpenCodeAdapter } from './opencode';
import { PiAdapter } from './pi';

/**
 * Adapter factory: instantiate the corresponding adapter by kind.
 * Adding a new agent = registering a subclass implementing AgentAdapter here, with no changes needed in
 * the upper layers (PLAN §2.5 / §9).
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
  }
}

export type AdapterFactory = typeof createAdapter;
