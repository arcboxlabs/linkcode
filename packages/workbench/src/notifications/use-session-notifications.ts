import { useLinkCodeClient } from '@linkcode/client-core';
import type { SessionId, SessionNotification } from '@linkcode/schema';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useTranslations } from 'use-intl';
import { useNotificationPrefsStore } from './prefs-store';
import { shouldPresent } from './should-present';

/** What a presenter shows; click-through routing (focus + select `sessionId`) is app-wired. */
export interface SessionNotificationDisplay {
  sessionId: SessionId;
  title: string;
  body: string;
}

/** App-injected OS presenter: desktop bridges to Electron main, webview to the Notification API. */
export type PresentSessionNotification = (display: SessionNotificationDisplay) => void;

/**
 * The shared decision layer: folds daemon-classified `session.notification` broadcasts through
 * presentation policy ({@link shouldPresent}) and hands the survivors to the app's presenter.
 * Mounts inside `Workbench` so the active-session identity is exact; without a presenter it's inert.
 */
export function useSessionNotifications(
  present: PresentSessionNotification | undefined,
  activeSessionId: SessionId | null,
): void {
  const client = useLinkCodeClient();
  const t = useTranslations('workbench.notifications');
  const tk = useTranslations('workbench.agentKind');

  useAbortableEffect(
    (signal) => {
      if (!present) return;
      return client.subscribeSessionNotification((notification) => {
        if (signal.aborted) return;
        const prefs = useNotificationPrefsStore.getState();
        if (!shouldPresent(prefs, notification, activeSessionId, document.hasFocus())) return;
        present({
          sessionId: notification.sessionId,
          title: notification.title ?? tk(notification.kind),
          body: bodyFor(notification, t),
        });
      });
    },
    [client, present, activeSessionId, t, tk],
  );
}

type NotificationsT = ReturnType<typeof useTranslations<'workbench.notifications'>>;

function bodyFor(notification: SessionNotification, t: NotificationsT): string {
  const reason = notification.reason;
  switch (reason.type) {
    case 'turn-completed':
      return t('turnCompleted');
    case 'awaiting-approval':
      return reason.toolTitle === undefined
        ? t('awaitingApproval')
        : t('awaitingApprovalTool', { tool: reason.toolTitle });
    case 'error':
      return reason.message;
    // no default
  }
}
