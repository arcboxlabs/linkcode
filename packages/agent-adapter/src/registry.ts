import type { AgentKind } from '@linkcode/schema';
import { AcpAdapter, type AcpAgentSpec } from './acp/acp-adapter';
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
  }
}

export type AdapterFactory = typeof createAdapter;

/**
 * Generic ACP seam: drive any ACP-speaking agent CLI as a subprocess. This is the "long tail" path
 * (native adapters for the four, a generic ACP adapter for the rest).
 */
export function createAcpAdapter(spec: AcpAgentSpec): AgentAdapter {
  return new AcpAdapter(spec);
}
