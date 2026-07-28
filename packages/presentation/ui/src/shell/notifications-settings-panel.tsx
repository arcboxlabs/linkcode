import { Switch } from 'coss-ui/components/switch';
import { useTranslations } from 'use-intl';
import { SettingsCard, SettingsRow } from './settings-page';

export type NotificationToggleKey = 'enabled' | 'turnCompleted' | 'awaitingApproval' | 'error';

export interface NotificationsSettingsPanelProps {
  enabled: boolean;
  turnCompleted: boolean;
  awaitingApproval: boolean;
  error: boolean;
  onChange: (key: NotificationToggleKey, value: boolean) => void;
  /** Browser Notification permission (webview only); desktop needs no permission and omits it. */
  permission?: NotificationPermission;
}

export function NotificationsSettingsPanel({
  enabled,
  turnCompleted,
  awaitingApproval,
  error,
  onChange,
  permission,
}: NotificationsSettingsPanelProps): React.ReactNode {
  const t = useTranslations('settings.notifications');

  return (
    <div className="flex flex-col gap-8">
      <SettingsCard>
        <SettingsRow title={t('enable')} description={t('enableHint')}>
          <Switch checked={enabled} onCheckedChange={(value) => onChange('enabled', value)} />
        </SettingsRow>
        {permission === 'denied' ? (
          <p className="px-4 py-3 text-destructive text-xs">{t('permissionDenied')}</p>
        ) : null}
        {enabled && permission === 'default' ? (
          <p className="px-4 py-3 text-muted-foreground text-xs">{t('permissionRequest')}</p>
        ) : null}
      </SettingsCard>

      <SettingsCard>
        <SettingsRow title={t('turnCompleted')} description={t('turnCompletedHint')}>
          <Switch
            checked={turnCompleted}
            disabled={!enabled}
            onCheckedChange={(value) => onChange('turnCompleted', value)}
          />
        </SettingsRow>
        <SettingsRow title={t('awaitingApproval')} description={t('awaitingApprovalHint')}>
          <Switch
            checked={awaitingApproval}
            disabled={!enabled}
            onCheckedChange={(value) => onChange('awaitingApproval', value)}
          />
        </SettingsRow>
        <SettingsRow title={t('error')} description={t('errorHint')}>
          <Switch
            checked={error}
            disabled={!enabled}
            onCheckedChange={(value) => onChange('error', value)}
          />
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}
