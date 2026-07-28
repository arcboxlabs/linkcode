import type { AgentHistoryId, SessionId, SessionInfo } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { importedSessionByHistoryId, importedSessionKey } from '../imported';

function session(
  overrides: Omit<Partial<SessionInfo>, 'sessionId'> & { sessionId: string },
): SessionInfo {
  return {
    kind: 'claude-code',
    cwd: '/repo',
    status: 'stopped',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
    sessionId: overrides.sessionId as SessionId,
  };
}

describe('importedSessionByHistoryId', () => {
  it('indexes the latest-run historyId', () => {
    const map = importedSessionByHistoryId([
      session({ sessionId: 's1', historyId: 'h1' as AgentHistoryId }),
    ]);
    expect(map.get(importedSessionKey('claude-code', 'h1'))).toBe('s1');
  });

  it('indexes a cold import through its origin only', () => {
    const map = importedSessionByHistoryId([
      session({
        sessionId: 's1',
        origin: { type: 'imported', historyId: 'h1' as AgentHistoryId, importedAt: 1 },
      }),
    ]);
    expect(map.get(importedSessionKey('claude-code', 'h1'))).toBe('s1');
  });

  it('scopes keys by agent kind', () => {
    const map = importedSessionByHistoryId([
      session({ sessionId: 's1', kind: 'codex', historyId: 'h1' as AgentHistoryId }),
    ]);
    expect(map.get(importedSessionKey('claude-code', 'h1'))).toBeUndefined();
    expect(map.get(importedSessionKey('codex', 'h1'))).toBe('s1');
  });

  it('ignores sessions without provider linkage', () => {
    const map = importedSessionByHistoryId([
      session({ sessionId: 's1', origin: { type: 'created' } }),
    ]);
    expect(map.size).toBe(0);
  });
});
