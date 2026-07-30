import type { Plugin, PluginScope } from '@linkcode/schema';
import type { PluginCardView } from '@linkcode/ui';
import { PluginsShell, PluginsTab } from '@linkcode/ui';
import { useState } from 'react';
import { useAgentRuntimes } from '../../agent-runtime/hooks';
import { usePlugins, useSetPluginEnabled } from './hooks';
import { filterPluginCards, pluginProviderGroups } from './view';

/**
 * The plugins/MCP/skills settings page container. Transport-backed — it must render inside
 * `WorkbenchProviders`, but may sit above the connection gate, degrading to loading while the
 * daemon is unreachable. Discovery is a CLI shell-out, so refresh is manual only.
 */
export function PluginsSettingsPanel(): React.ReactNode {
  const { data, isLoading, isValidating, mutate } = usePlugins();
  const { data: runtimes } = useAgentRuntimes();
  const toggle = useSetPluginEnabled();
  const [searchQuery, setSearchQuery] = useState('');

  const missingRuntimes = new Set<string>();
  for (const [kind, runtime] of Object.entries(runtimes ?? {})) {
    if (runtime.status === 'missing') missingRuntimes.add(kind);
  }

  const groups =
    data === undefined
      ? undefined
      : pluginProviderGroups(data).map((group) => ({
          ...group,
          plugins: filterPluginCards(group.plugins, searchQuery),
        }));

  const onToggleInstallation = async (
    card: PluginCardView,
    scope: PluginScope | undefined,
    enabled: boolean,
  ): Promise<void> => {
    const updated = await toggle.trigger({ provider: card.provider, id: card.id, enabled, scope });
    if (updated === undefined) return;
    // Fold the single re-listed plugin into the cache instead of revalidating: a full mutate()
    // would re-run the expensive CLI discovery for one switch flip.
    void mutate(
      (current) =>
        current && {
          ...current,
          plugins: current.plugins.map((plugin) => replaceIfSame(plugin, updated)),
        },
      { revalidate: false },
    );
  };

  return (
    <PluginsShell
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onRefresh={() => {
        void mutate();
      }}
      refreshing={isLoading || isValidating}
      pluginsTab={
        <PluginsTab
          busy={toggle.isMutating}
          groups={groups}
          missingRuntimes={missingRuntimes}
          searchQuery={searchQuery}
          onToggleInstallation={(card, scope, enabled) => {
            void onToggleInstallation(card, scope, enabled);
          }}
        />
      }
      mcpTab={null}
      skillsTab={null}
    />
  );
}

function replaceIfSame(plugin: Plugin, updated: Plugin): Plugin {
  return plugin.provider === updated.provider && plugin.id === updated.id ? updated : plugin;
}
