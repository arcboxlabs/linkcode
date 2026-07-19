import { Field, FieldDescription, FieldLabel } from 'coss-ui/components/field';
import { Switch } from 'coss-ui/components/switch';
import { useTranslations } from 'use-intl';

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
    <div className="flex flex-col gap-6">
      <Field>
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <FieldLabel>{t('enable')}</FieldLabel>
            <FieldDescription>{t('enableHint')}</FieldDescription>
          </div>
          <Switch checked={enabled} onCheckedChange={(value) => onChange('enabled', value)} />
        </div>
        {permission === 'denied' ? (
          <p className="mt-1 text-destructive text-sm">{t('permissionDenied')}</p>
        ) : null}
        {enabled && permission === 'default' ? (
          <p className="mt-1 text-muted-foreground text-sm">{t('permissionRequest')}</p>
        ) : null}
      </Field>

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <ReasonToggle
          label={t('turnCompleted')}
          hint={t('turnCompletedHint')}
          checked={turnCompleted}
          disabled={!enabled}
          onChange={(value) => onChange('turnCompleted', value)}
        />
        <ReasonToggle
          label={t('awaitingApproval')}
          hint={t('awaitingApprovalHint')}
          checked={awaitingApproval}
          disabled={!enabled}
          onChange={(value) => onChange('awaitingApproval', value)}
        />
        <ReasonToggle
          label={t('error')}
          hint={t('errorHint')}
          checked={error}
          disabled={!enabled}
          onChange={(value) => onChange('error', value)}
        />
      </div>
    </div>
  );
}

function ReasonToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}): React.ReactNode {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-sm">{label}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
