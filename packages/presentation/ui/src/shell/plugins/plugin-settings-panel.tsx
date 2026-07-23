import { Alert, AlertDescription } from 'coss-ui/components/alert';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Skeleton } from 'coss-ui/components/skeleton';
import { Switch } from 'coss-ui/components/switch';
import { PlusIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { SettingsCard, SettingsSection } from '../settings-page';

export type PluginUnitCardStatus = 'disabled' | 'ready' | 'partial' | 'unavailable';
export type PluginServerCardStatus =
  | 'ready'
  | 'satisfied'
  | 'expired-credential'
  | 'unsatisfied-binding'
  | 'broker-unavailable';

export interface PluginServerCardView {
  name: string;
  /** Localized service display name, when the server depends on one. */
  serviceLabel?: string;
  status: PluginServerCardStatus;
}

export interface PluginUnitCardView {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  status: PluginUnitCardStatus;
  servers: PluginServerCardView[];
}

/** A user-imported MCP server, projected for display; env/header values never reach the client. */
export interface CustomServerCardView {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  enabled: boolean;
  /** command (stdio) or url (http). */
  detail: string;
  /** Configured env/header keys, masked — values are never present. */
  secretKeys: string[];
}

export interface PluginSettingsPanelProps {
  /** Undefined while catalog/config load — the cards render as skeletons. */
  units: PluginUnitCardView[] | undefined;
  /** User-imported servers; undefined while config loads. */
  customServers: CustomServerCardView[] | undefined;
  error?: string;
  busy: boolean;
  onEnabledChange: (unitId: string, enabled: boolean) => void;
  onCustomToggle: (id: string, enabled: boolean) => void;
  onCustomRemove: (id: string) => void;
  onAddCustom: () => void;
}

const UNIT_BADGE_VARIANT = {
  ready: 'success',
  partial: 'warning',
  unavailable: 'warning',
  disabled: 'secondary',
} as const;

const SERVER_BADGE_VARIANT = {
  ready: 'success',
  satisfied: 'success',
  'expired-credential': 'warning',
  'unsatisfied-binding': 'outline',
  'broker-unavailable': 'secondary',
} as const;

/** Pure card list for MCP capability units: label, enablement, and per-server status. */
export function PluginSettingsPanel({
  units,
  customServers,
  error,
  busy,
  onEnabledChange,
  onCustomToggle,
  onCustomRemove,
  onAddCustom,
}: PluginSettingsPanelProps): React.ReactNode {
  const t = useTranslations('settings.plugins');

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-sm">{t('hint')}</p>

      {error === undefined ? null : (
        <Alert variant="error">
          <TriangleAlertIcon />
          <AlertDescription>{t('loadError', { message: error })}</AlertDescription>
        </Alert>
      )}

      <SettingsSection title={t('unitsTitle')}>
        <SettingsCard>
          {units === undefined ? (
            <PluginUnitSkeleton />
          ) : (
            units.map((unit) => (
              <div key={unit.id} className="flex flex-col gap-3 px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{unit.label}</p>
                      <Badge variant={UNIT_BADGE_VARIANT[unit.status]}>
                        {t(`status.${unit.status}`)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-muted-foreground text-xs">{unit.description}</p>
                  </div>
                  <Switch
                    aria-label={t('enabledLabel', { name: unit.label })}
                    checked={unit.enabled}
                    disabled={busy}
                    onCheckedChange={(enabled) => onEnabledChange(unit.id, enabled)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  {unit.servers.map((server) => (
                    <div key={server.name} className="flex items-center justify-between gap-3">
                      <span className="truncate text-muted-foreground text-xs">
                        {server.name}
                        {server.serviceLabel === undefined ? '' : ` · ${server.serviceLabel}`}
                      </span>
                      <Badge variant={SERVER_BADGE_VARIANT[server.status]}>
                        {t(`serverStatus.${server.status}`)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('customTitle')}>
        <p className="px-1 text-muted-foreground text-xs">{t('customHint')}</p>
        <SettingsCard>
          {customServers === undefined ? (
            <PluginUnitSkeleton />
          ) : customServers.length === 0 ? (
            <div className="px-4 py-4 text-muted-foreground text-sm">{t('customEmpty')}</div>
          ) : (
            customServers.map((server) => (
              <div key={server.id} className="flex items-start justify-between gap-4 px-4 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-sm">{server.name}</p>
                    <Badge variant="outline">{server.transport}</Badge>
                  </div>
                  <p className="mt-0.5 truncate text-muted-foreground text-xs">{server.detail}</p>
                  {server.secretKeys.length > 0 && (
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {t('customSecretKeys', { keys: server.secretKeys.join(', ') })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    aria-label={t('enabledLabel', { name: server.name })}
                    checked={server.enabled}
                    disabled={busy}
                    onCheckedChange={(enabled) => onCustomToggle(server.id, enabled)}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('customRemove', { name: server.name })}
                    disabled={busy}
                    onClick={() => onCustomRemove(server.id)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              </div>
            ))
          )}
        </SettingsCard>
        <div>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onAddCustom}>
            <PlusIcon />
            {t('customAdd')}
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}

function PluginUnitSkeleton(): React.ReactNode {
  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-1.5 h-3 w-72" />
        </div>
        <Skeleton className="h-5 w-9 rounded-full" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-4 w-16" />
      </div>
    </div>
  );
}
