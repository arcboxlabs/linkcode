import type { AgentHistoryId, AgentHistorySession } from '@linkcode/schema';

const DAY_MS = 24 * 3_600_000;

export interface SeedHistoryEntry extends Omit<AgentHistorySession, 'createdAt' | 'updatedAt'> {
  ageMs: number;
}

/** Provider-local history the sidebar's per-workspace import drilldown lists and imports from. */
export const SEED_HISTORY: SeedHistoryEntry[] = [
  {
    historyId: 'mock-hist-claude-1' as AgentHistoryId,
    kind: 'claude-code',
    title: 'Design the wire protocol envelope',
    cwd: '/mock/linkcode',
    messageCount: 24,
    ageMs: 3 * DAY_MS,
  },
  {
    historyId: 'mock-hist-codex-1' as AgentHistoryId,
    kind: 'codex',
    title: 'Spike reconnect backoff strategies',
    cwd: '/mock/linkcode',
    messageCount: 9,
    ageMs: 5 * DAY_MS,
  },
  {
    historyId: 'mock-hist-claude-2' as AgentHistoryId,
    kind: 'claude-code',
    title: 'Audit fleet table queries',
    cwd: '/mock/platform',
    messageCount: 41,
    ageMs: 9 * DAY_MS,
  },
];
