import type { AgentKind } from '@linkcode/schema';

/** Platform-neutral agent presentation data, shared by the web and native icon components. */
export const AGENT_LABELS: Record<AgentKind, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  pi: 'Pi',
  'grok-build': 'Grok Build',
};

// Safety fallback if an icon renderer cannot provide a brand glyph.
export const AGENT_INITIALS: Record<AgentKind, string> = {
  'claude-code': 'CC',
  codex: 'CX',
  opencode: 'OC',
  pi: 'PI',
  'grok-build': 'GB',
};
