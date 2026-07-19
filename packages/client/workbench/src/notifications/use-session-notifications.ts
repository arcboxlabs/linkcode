import { useLinkCodeClient } from '@linkcode/client-core';
import type { SessionId, SessionNotification } from '@linkcode/schema';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useTranslations } from 'use-intl';
import { useSessionSelectionStore } from '../surface/selection-store';
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
 * Folds daemon-classified `session.notification` broadcasts through {@link shouldPresent} and
 * hands survivors to the app's presenter. Suppression keys on the selection store, so this can
 * mount in a persistent layer — a routed mount would drop background notifications whenever the
 * user navigates away. Inert without a presenter.
 */
export function useSessionNotifications(present: PresentSessionNotification | undefined): void {
  const client = useLinkCodeClient();
  const t = useTranslations('workbench.notifications');
  const tk = useTranslations('workbench.agentKind');

  useAbortableEffect(
    (signal) => {
      if (!present) return;
      return client.subscribeSessionNotification((notification) => {
        if (signal.aborted) return;
        const prefs = useNotificationPrefsStore.getState();
        const selectedId = useSessionSelectionStore.getState().selectedId;
        if (!shouldPresent(prefs, notification, selectedId, document.hasFocus())) return;
        present({
          sessionId: notification.sessionId,
          title: notification.title ?? tk(notification.kind),
          body: bodyFor(notification, t),
        });
      });
    },
    [client, present, t, tk],
  );
}

/**
 * Headless mount of {@link useSessionNotifications} for a persistent layer, so the subscription
 * outlives route changes. Renders nothing.
 */
export function SessionNotifier({
  present,
}: {
  present?: PresentSessionNotification;
}): React.ReactNode {
  useSessionNotifications(present);
  return null;
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
