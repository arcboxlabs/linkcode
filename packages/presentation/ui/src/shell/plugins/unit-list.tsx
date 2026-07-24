import { Badge } from 'coss-ui/components/badge';
import { Skeleton } from 'coss-ui/components/skeleton';
import { Switch } from 'coss-ui/components/switch';
import { useTranslations } from 'use-intl';
import { SettingsCard } from '../settings-page';
import type { PluginUnitCardView } from './types';

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

/** Card list of MCP capability units: label, enablement, and per-server status. */
export function PluginUnitList({
  units,
  emptyLabel,
  busy,
  onEnabledChange,
}: {
  /** Undefined while catalog/config load — the cards render as skeletons. */
  units: PluginUnitCardView[] | undefined;
  emptyLabel: string;
  busy: boolean;
  onEnabledChange: (unitId: string, enabled: boolean) => void;
}): React.ReactNode {
  const t = useTranslations('settings.plugins');

  return (
    <SettingsCard>
      {units === undefined ? (
        <PluginCardSkeleton />
      ) : units.length === 0 ? (
        <div className="px-4 py-4 text-muted-foreground text-sm">{emptyLabel}</div>
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
  );
}

export function PluginCardSkeleton(): React.ReactNode {
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
