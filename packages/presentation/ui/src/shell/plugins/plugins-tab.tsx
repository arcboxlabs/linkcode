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

export interface PluginsTabProps {
  /** Undefined while the first discovery is loading (skeletons). */
  groups: PluginProviderGroup[] | undefined;
  /** Providers whose runtime the host has not detected at all. */
  missingRuntimes: ReadonlySet<string>;
  searchQuery: string;
  busy: boolean;
  onToggleInstallation: (
    card: PluginCardView,
    scope: PluginScope | undefined,
    enabled: boolean,
  ) => void;
}

/** Provider-grouped plugin cards with honest empty/failed/missing states. */
export function PluginsTab({
  groups,
  missingRuntimes,
  searchQuery,
  busy,
  onToggleInstallation,
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
  return (
    <div className="flex flex-col gap-6 pt-2">
      {groups.map((group) => {
        const label = AGENT_LABELS[group.provider];
        return (
          <SettingsSection key={group.provider} title={label}>
            {group.discoveryFailed ? (
              <EmptyRow
                text={t('discoveryFailed', {
                  provider: label,
                  reason: group.failureReason ?? t('discoveryFailedUnknown'),
                })}
              />
            ) : group.plugins.length === 0 ? (
              <EmptyRow
                text={
                  filtering
                    ? t('noSearchResults')
                    : missingRuntimes.has(group.provider)
                      ? t('runtimeMissing', { provider: label })
                      : t('emptyHint')
                }
              />
            ) : (
              <div className="flex flex-col gap-3">
                {group.plugins.map((card) => (
                  <PluginCard
                    key={card.key}
                    busy={busy}
                    card={card}
                    onToggleInstallation={onToggleInstallation}
                  />
                ))}
              </div>
            )}
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
