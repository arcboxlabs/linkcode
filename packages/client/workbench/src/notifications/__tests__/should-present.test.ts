import type { SessionId, SessionNotification, SessionNotificationReason } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { NotificationPolicyPrefs } from '../should-present';
import { shouldPresent } from '../should-present';

const sessionId = 'sess-1' as SessionId;
const otherSessionId = 'sess-2' as SessionId;

const allOn: NotificationPolicyPrefs = {
  enabled: true,
  turnCompleted: true,
  awaitingApproval: true,
  error: true,
};

function notification(reason: SessionNotificationReason): SessionNotification {
  return { sessionId, kind: 'claude-code', cwd: '/repo', title: 'Fix tests', reason };
}

const turnCompleted = notification({ type: 'turn-completed', stopReason: 'end_turn' });

describe('shouldPresent', () => {
  it('presents background-session moments regardless of window focus', () => {
    expect(shouldPresent(allOn, turnCompleted, otherSessionId, true)).toBe(true);
    expect(shouldPresent(allOn, turnCompleted, otherSessionId, false)).toBe(true);
  });

  it('suppresses the active session only while the window is focused', () => {
    expect(shouldPresent(allOn, turnCompleted, sessionId, true)).toBe(false);
    expect(shouldPresent(allOn, turnCompleted, sessionId, false)).toBe(true);
  });

  it('never presents user-initiated cancels', () => {
    const cancelled = notification({ type: 'turn-completed', stopReason: 'cancelled' });
    expect(shouldPresent(allOn, cancelled, otherSessionId, false)).toBe(false);
  });

  it('honors the master switch and the per-reason toggles', () => {
    expect(shouldPresent({ ...allOn, enabled: false }, turnCompleted, null, false)).toBe(false);
    expect(shouldPresent({ ...allOn, turnCompleted: false }, turnCompleted, null, false)).toBe(
      false,
    );

    const approval = notification({ type: 'awaiting-approval', toolTitle: 'Bash' });
    expect(shouldPresent({ ...allOn, awaitingApproval: false }, approval, null, false)).toBe(false);
    expect(shouldPresent(allOn, approval, null, false)).toBe(true);

    const error = notification({ type: 'error', message: 'boom' });
    expect(shouldPresent({ ...allOn, error: false }, error, null, false)).toBe(false);
    expect(shouldPresent(allOn, error, null, false)).toBe(true);
  });
});
