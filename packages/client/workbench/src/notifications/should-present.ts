import type { SessionId, SessionNotification } from '@linkcode/schema';

export interface NotificationPolicyPrefs {
  enabled: boolean;
  turnCompleted: boolean;
  awaitingApproval: boolean;
  error: boolean;
}

/** Presentation policy for a daemon-classified `session.notification`: preference gates, skip
 * user-initiated cancels, suppress while already looking (window focused + session active). */
export function shouldPresent(
  prefs: NotificationPolicyPrefs,
  notification: SessionNotification,
  activeSessionId: SessionId | null,
  windowFocused: boolean,
): boolean {
  if (!prefs.enabled) return false;
  const reason = notification.reason;
  switch (reason.type) {
    case 'turn-completed':
      if (!prefs.turnCompleted || reason.stopReason === 'cancelled') return false;
      break;
    case 'awaiting-approval':
      if (!prefs.awaitingApproval) return false;
      break;
    case 'error':
      if (!prefs.error) return false;
      break;
    // no default
  }
  return !windowFocused || notification.sessionId !== activeSessionId;
}
