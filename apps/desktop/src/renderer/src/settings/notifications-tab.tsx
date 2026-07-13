import { NotificationsSettingsPanel } from '@linkcode/ui';
import { useNotificationPrefsStore } from '@linkcode/workbench';

export function NotificationsTab(): React.ReactNode {
  const enabled = useNotificationPrefsStore((state) => state.enabled);
  const turnCompleted = useNotificationPrefsStore((state) => state.turnCompleted);
  const awaitingApproval = useNotificationPrefsStore((state) => state.awaitingApproval);
  const error = useNotificationPrefsStore((state) => state.error);
  const setPref = useNotificationPrefsStore((state) => state.setPref);

  return (
    <NotificationsSettingsPanel
      enabled={enabled}
      turnCompleted={turnCompleted}
      awaitingApproval={awaitingApproval}
      error={error}
      onChange={setPref}
    />
  );
}
