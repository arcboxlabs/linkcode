import { Alert, AlertDescription } from 'coss-ui/components/alert';
import { Badge } from 'coss-ui/components/badge';
import { Skeleton } from 'coss-ui/components/skeleton';
import { Switch } from 'coss-ui/components/switch';
import { TriangleAlertIcon } from 'lucide-react';
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

export interface PluginSettingsPanelProps {
  /** Undefined while catalog/config load — the cards render as skeletons. */
  units: PluginUnitCardView[] | undefined;
  error?: string;
  busy: boolean;
  onEnabledChange: (unitId: string, enabled: boolean) => void;
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
  error,
  busy,
  onEnabledChange,
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
