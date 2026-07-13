import { NotificationsSettingsPanel } from '@linkcode/ui';
import type { NotificationPrefKey } from '@linkcode/workbench';
import { useNotificationPrefsStore } from '@linkcode/workbench';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

export function NotificationsSettings(): React.ReactNode {
  const tTabs = useTranslations('settings.tabs');
  usePageTitle(tTabs('notifications'));
  const enabled = useNotificationPrefsStore((state) => state.enabled);
  const turnCompleted = useNotificationPrefsStore((state) => state.turnCompleted);
  const awaitingApproval = useNotificationPrefsStore((state) => state.awaitingApproval);
  const error = useNotificationPrefsStore((state) => state.error);
  const setPref = useNotificationPrefsStore((state) => state.setPref);

  // `Notification.permission` is not reactive — track it locally and refresh after each request.
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  );

  const handleChange = (key: NotificationPrefKey, value: boolean): void => {
    setPref(key, value);
    if (key === 'enabled' && value && permission === 'default') {
      void Notification.requestPermission().then(setPermission);
    }
  };

  return (
    <NotificationsSettingsPanel
      enabled={enabled}
      turnCompleted={turnCompleted}
      awaitingApproval={awaitingApproval}
      error={error}
      onChange={handleChange}
      permission={permission}
    />
  );
}
