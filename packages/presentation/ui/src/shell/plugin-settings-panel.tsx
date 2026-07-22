import { Alert, AlertDescription } from 'coss-ui/components/alert';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { Skeleton } from 'coss-ui/components/skeleton';
import { Switch } from 'coss-ui/components/switch';
import { PencilIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { SettingsCard, SettingsSection } from './settings-page';

export interface PluginConnectionOptionView {
  id: string;
  label: string;
}

export interface PluginUnitSettingsView {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  connectionId?: string;
  connectionOptions: PluginConnectionOptionView[];
}

export interface PluginSavedConnectionView {
  id: string;
  label: string;
  credentialType: 'api-key' | 'auth-token';
}

export interface PluginSettingsPanelProps {
  units: PluginUnitSettingsView[] | undefined;
  connections: PluginSavedConnectionView[] | undefined;
  error?: string;
  busy: boolean;
  onEnabledChange: (unitId: string, enabled: boolean) => void;
  onConnectionChange: (unitId: string, connectionId: string) => void;
  onAddConnection: () => void;
  onEditConnection: (connectionId: string) => void;
  onRemoveConnection: (connectionId: string) => void;
}

/** Pure plugin settings presentation. Catalog/config state and every mutation arrive via props. */
export function PluginSettingsPanel({
  units,
  connections,
  error,
  busy,
  onEnabledChange,
  onConnectionChange,
  onAddConnection,
  onEditConnection,
  onRemoveConnection,
}: PluginSettingsPanelProps): React.ReactNode {
  const t = useTranslations('settings.plugins');

  return (
    <div className="flex flex-col gap-8">
      <p className="text-muted-foreground text-sm">{t('hint')}</p>

      <Alert variant="warning">
        <TriangleAlertIcon />
        <AlertDescription>{t('managedUnavailable')}</AlertDescription>
      </Alert>

      {error === undefined ? null : (
        <Alert variant="error">
          <TriangleAlertIcon />
          <AlertDescription>{t('loadError', { message: error })}</AlertDescription>
        </Alert>
      )}

      <SettingsSection title={t('toolsTitle')}>
        <SettingsCard>
          {units === undefined ? (
            <PluginUnitSkeleton />
          ) : (
            units.map((unit) => (
              <div key={unit.id} className="flex flex-col gap-3 px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{unit.label}</p>
                    <p className="mt-0.5 text-muted-foreground text-xs">{unit.description}</p>
                  </div>
                  <Switch
                    aria-label={t('enabledLabel', { name: unit.label })}
                    checked={unit.enabled}
                    disabled={busy}
                    onCheckedChange={(enabled) => onEnabledChange(unit.id, enabled)}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground text-xs">{t('usesConnection')}</span>
                  {unit.connectionOptions.length === 0 ? (
                    <span className="text-muted-foreground text-xs">{t('noConnection')}</span>
                  ) : (
                    <Select
                      items={unit.connectionOptions.map((connection) => ({
                        value: connection.id,
                        label: connection.label,
                      }))}
                      value={unit.connectionId ?? null}
                      disabled={busy}
                      onValueChange={(connectionId) => {
                        if (connectionId !== null) onConnectionChange(unit.id, connectionId);
                      }}
                    >
                      <SelectTrigger className="w-52">
                        <SelectValue placeholder={t('chooseConnection')} />
                      </SelectTrigger>
                      <SelectPopup>
                        {unit.connectionOptions.map((connection) => (
                          <SelectItem key={connection.id} value={connection.id}>
                            {connection.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  )}
                </div>
              </div>
            ))
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('connectionsTitle')}>
        <SettingsCard>
          {connections === undefined ? (
            <ConnectionSkeleton />
          ) : connections.length === 0 ? (
            <div className="flex items-center justify-between gap-4 px-4 py-4">
              <p className="text-muted-foreground text-sm">{t('connectionsEmpty')}</p>
              <AddConnectionButton disabled={busy} onClick={onAddConnection} />
            </div>
          ) : (
            <>
              {connections.map((connection) => (
                <div key={connection.id} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{connection.label}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="success">{t('credentialSaved')}</Badge>
                      <span className="text-muted-foreground text-xs">
                        {t(`credentialType.${connection.credentialType}`)}
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('editConnection', { name: connection.label })}
                    disabled={busy}
                    onClick={() => onEditConnection(connection.id)}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('removeConnection', { name: connection.label })}
                    disabled={busy}
                    onClick={() => onRemoveConnection(connection.id)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <div className="flex justify-end px-4 py-3">
                <AddConnectionButton disabled={busy} onClick={onAddConnection} />
              </div>
            </>
          )}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

function AddConnectionButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}): React.ReactNode {
  const t = useTranslations('settings.plugins');
  return (
    <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onClick}>
      <PlusIcon />
      {t('addConnection')}
    </Button>
  );
}

function PluginUnitSkeleton(): React.ReactNode {
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
        </div>
        <Skeleton className="h-5 w-9 rounded-full" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-8 w-52" />
      </div>
    </div>
  );
}

function ConnectionSkeleton(): React.ReactNode {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="size-8" />
      <Skeleton className="size-8" />
    </div>
  );
}
