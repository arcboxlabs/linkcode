import type { PluginScope } from '@linkcode/schema';
import { Card } from 'coss-ui/components/card';
import { Skeleton } from 'coss-ui/components/skeleton';
import { createFixedArray } from 'foxact/create-fixed-array';
import { useTranslations } from 'use-intl';
import { AGENT_LABELS } from '../../chat/agent-icon';
import { SettingsSection } from '../settings-page';
import { PluginCard } from './plugin-card';
import type { PluginCardView, PluginProviderGroup } from './types';

const SKELETON_ROWS = createFixedArray(3);

/** A marketplace listing runs to hundreds of entries per provider, so the market list renders a
 * bounded slice and says so; search narrows it. Never truncate silently. */
const MARKET_RENDER_LIMIT = 60;

export interface PluginsTabProps {
  /** Undefined while the first discovery is loading (skeletons). */
  groups: PluginProviderGroup[] | undefined;
  /** `installed` lists what the host has; `market` lists uninstalled marketplace entries. */
  variant: 'installed' | 'market';
  /** Providers whose runtime the host has not detected at all. */
  missingRuntimes: ReadonlySet<string>;
  searchQuery: string;
  busy: boolean;
  onToggleInstallation: (
    card: PluginCardView,
    scope: PluginScope | undefined,
    enabled: boolean,
  ) => void;
  onInstall: (card: PluginCardView) => void;
  onUninstall: (card: PluginCardView) => void;
}

/** Provider-grouped plugin cards with honest empty/failed/missing states. */
export function PluginsTab({
  groups,
  variant,
  missingRuntimes,
  searchQuery,
  busy,
  onToggleInstallation,
  onInstall,
  onUninstall,
}: PluginsTabProps): React.ReactNode {
  const t = useTranslations('settings.plugins');
  if (groups === undefined) {
    return (
      <div className="flex flex-col gap-3 pt-2">
        {SKELETON_ROWS.map((index) => (
          <Skeleton key={index} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  const filtering = searchQuery.trim().length > 0;
  const market = variant === 'market';
  return (
    <div className="flex flex-col gap-6 pt-2">
      {groups.map((group) => {
        const label = AGENT_LABELS[group.provider];
        const visible = market ? group.plugins.slice(0, MARKET_RENDER_LIMIT) : group.plugins;
        return (
          <SettingsSection
            key={group.provider}
            title={
              <span className="flex w-full items-center justify-between">
                {label}
                {market && group.plugins.length > 0 ? (
                  <span className="font-normal text-2xs text-label-tertiary tabular-nums">
                    {t('marketCount', { count: group.plugins.length })}
                  </span>
                ) : null}
              </span>
            }
          >
            <div className="flex flex-col gap-3">
              {group.discoveryFailed ? (
                <EmptyRow
                  text={t('discoveryFailed', {
                    harness: label,
                    reason: group.failureReason ?? t('discoveryFailedUnknown'),
                  })}
                />
              ) : null}
              {group.plugins.length === 0 && !group.discoveryFailed ? (
                <EmptyRow
                  text={
                    filtering
                      ? t('noSearchResults')
                      : missingRuntimes.has(group.provider)
                        ? t('runtimeMissing', { harness: label })
                        : market
                          ? t('marketEmptyHint')
                          : t('installedEmptyHint')
                  }
                />
              ) : (
                <>
                  {visible.map((card) => (
                    <PluginCard
                      key={card.key}
                      busy={busy}
                      card={card}
                      showInstallState={!market}
                      onToggleInstallation={onToggleInstallation}
                      onInstall={onInstall}
                      onUninstall={onUninstall}
                    />
                  ))}
                  {visible.length < group.plugins.length ? (
                    <p className="px-1 text-muted-foreground text-xs">
                      {t('marketTruncated', {
                        shown: visible.length,
                        total: group.plugins.length,
                      })}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </SettingsSection>
        );
      })}
    </div>
  );
}

function EmptyRow({ text }: { text: string }): React.ReactNode {
  return (
    <Card className="px-4 py-4">
      <p className="text-muted-foreground text-sm">{text}</p>
    </Card>
  );
}
