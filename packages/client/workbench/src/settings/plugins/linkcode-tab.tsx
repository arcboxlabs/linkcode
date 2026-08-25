import type { PluginMarketRefresh } from '@linkcode/client-core';
import type { LinkCodeMarketplaceConfig, LinkCodePluginId } from '@linkcode/schema';
import { refreshPluginMarketplace } from '@linkcode/sdk';
import type { LinkCodeCatalogCardView, LinkCodeInstalledPluginRow } from '@linkcode/ui';
import { LinkCodeCatalogSection, LinkCodeInstalledSection } from '@linkcode/ui';
import { Card } from 'coss-ui/components/card';
import { noop } from 'foxts/noop';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  useInstallLinkCodePlugin,
  useLinkCodePluginConfigs,
  usePluginMarketCatalog,
  usePluginMarketplaces,
  useSetLinkCodePluginConfig,
  useUninstallLinkCodePlugin,
} from './hooks';
import type { LinkCodePluginConfigPatch } from './linkcode-config-dialog';
import { LinkCodePluginConfigDialog } from './linkcode-config-dialog';
import { filterLinkCodeCatalogCards, linkcodeCatalogCards, linkcodeInstalledRow } from './view';

export interface LinkCodeMarketTabProps {
  searchQuery: string;
}

/**
 * The LinkCode marketplace tab: installed plugins with their manifest-driven settings on top,
 * each configured marketplace's catalog below. Installed state comes from the masked
 * `plugin-config.listed` read; the catalog from `plugin-market.refresh` (the daemon is the only
 * networked leg).
 */
export function LinkCodeMarketTab({ searchQuery }: LinkCodeMarketTabProps): React.ReactNode {
  const t = useTranslations('settings.plugins.linkcode');
  const { data: marketplaces } = usePluginMarketplaces();
  const { data: configs, mutate: mutateConfigs } = useLinkCodePluginConfigs();
  const install = useInstallLinkCodePlugin();
  const uninstall = useUninstallLinkCodePlugin();
  const save = useSetLinkCodePluginConfig();
  const [configuring, setConfiguring] = useState<LinkCodePluginId | null>(null);

  const installedVersions = new Map((configs ?? []).map((view) => [view.id, view.version]));
  const rows = configs?.map(linkcodeInstalledRow);
  const configById = new Map((configs ?? []).map((view) => [view.id, view]));
  const editing = configuring === null ? undefined : configById.get(configuring);
  const busy = install.isMutating || uninstall.isMutating;
  // The daemon rejects refresh/install on a disabled marketplace, so rendering one would leave
  // its section on loading skeletons forever.
  const enabledMarketplaces = marketplaces?.filter((marketplace) => marketplace.enabled);

  const onInstall = async (card: LinkCodeCatalogCardView): Promise<void> => {
    await install.trigger({
      release: {
        marketplaceId: card.marketplaceId,
        pluginId: card.pluginId,
        version: card.version,
      },
    });
    await mutateConfigs();
  };

  const onUninstall = async (row: LinkCodeInstalledPluginRow): Promise<void> => {
    await uninstall.trigger({ pluginId: row.pluginId });
    await mutateConfigs();
  };

  const onSubmitConfig = async (patch: LinkCodePluginConfigPatch): Promise<void> => {
    if (editing === undefined) return;
    const result = await save.trigger({ pluginId: editing.id, ...patch });
    // Fold the post-patch masked values into the cache instead of re-listing.
    await mutateConfigs(
      (current) =>
        current?.map((view) =>
          view.id === result.pluginId ? { ...view, values: result.values } : view,
        ),
      { revalidate: false },
    );
    setConfiguring(null);
  };

  return (
    <div className="flex flex-col gap-6 pt-2">
      <p className="text-muted-foreground text-sm">{t('hint')}</p>
      <LinkCodeInstalledSection
        rows={rows}
        busy={busy}
        onConfigure={(row) => setConfiguring(row.pluginId)}
        onUninstall={(row) => {
          void onUninstall(row).catch(noop);
        }}
      />
      {enabledMarketplaces === undefined ? null : enabledMarketplaces.length === 0 ? (
        <Card className="px-4 py-4">
          <p className="text-muted-foreground text-sm">
            {marketplaces?.length === 0 ? t('noMarketplaces') : t('allMarketplacesDisabled')}
          </p>
        </Card>
      ) : (
        enabledMarketplaces.map((marketplace) => (
          <MarketplaceCatalog
            key={marketplace.id}
            marketplace={marketplace}
            installedVersions={installedVersions}
            searchQuery={searchQuery}
            busy={busy}
            onInstall={(card) => {
              void onInstall(card).catch(noop);
            }}
          />
        ))
      )}
      {editing === undefined ? null : (
        <LinkCodePluginConfigDialog
          key={editing.id}
          title={editing.id}
          settings={editing.settings}
          values={editing.values}
          busy={save.isMutating}
          onClose={() => setConfiguring(null)}
          onSubmit={(patch) => {
            void onSubmitConfig(patch).catch(noop);
          }}
        />
      )}
    </div>
  );
}

function MarketplaceCatalog({
  marketplace,
  installedVersions,
  searchQuery,
  busy,
  onInstall,
}: {
  marketplace: LinkCodeMarketplaceConfig;
  installedVersions: ReadonlyMap<string, string>;
  searchQuery: string;
  busy: boolean;
  onInstall: (card: LinkCodeCatalogCardView) => void;
}): React.ReactNode {
  const { data, isLoading, isValidating, mutate } = usePluginMarketCatalog(marketplace.id);

  const cards =
    data === undefined
      ? undefined
      : filterLinkCodeCatalogCards(
          linkcodeCatalogCards(marketplace.id, data.releases, installedVersions),
          searchQuery,
        );

  // Keep this defensive merge for pre-wire-80 daemons that still return an empty 304 payload.
  const onRefresh = (): void => {
    void mutate(
      async (current): Promise<PluginMarketRefresh> => {
        const { data: next } = await refreshPluginMarketplace({
          marketplaceId: marketplace.id,
        });
        if (current !== undefined && next.notModified === true) {
          return { ...next, releases: current.releases };
        }
        return next;
      },
      { revalidate: false },
    ).catch(noop);
  };

  return (
    <LinkCodeCatalogSection
      title={marketplace.displayName ?? marketplace.id}
      cards={cards}
      busy={busy}
      refreshing={isLoading || isValidating}
      onRefresh={onRefresh}
      onInstall={onInstall}
    />
  );
}
