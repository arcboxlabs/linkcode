import type { Plugin, PluginScope } from '@linkcode/schema';
import type { PluginCardView, SkillRowView } from '@linkcode/ui';
import { PluginsShell, PluginsTab, SkillsTab } from '@linkcode/ui';
import { toastManager } from 'coss-ui/components/toast';
import { noop } from 'foxts/noop';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useAgentRuntimes } from '../../agent-runtime/hooks';
import {
  useInstallPlugin,
  usePlugins,
  useSetPluginEnabled,
  useSetSkillEnabled,
  useUninstallPlugin,
} from './hooks';
import { LinkCodeMarketTab } from './linkcode-tab';
import { McpTab } from './mcp-settings';
import { filterPluginCards, pluginMcpServerRows, pluginProviderGroups, skillRows } from './view';

/**
 * The plugins/MCP/skills settings page container. Transport-backed — it must render inside
 * `WorkbenchProviders`, but may sit above the connection gate, degrading to loading while the
 * daemon is unreachable. Discovery is a CLI shell-out, so refresh is manual only.
 */
export function PluginsSettingsPanel(): React.ReactNode {
  const t = useTranslations('settings.plugins');
  const { data, isLoading, isValidating, mutate } = usePlugins();
  const { data: runtimes } = useAgentRuntimes();
  const toggle = useSetPluginEnabled();
  const toggleSkill = useSetSkillEnabled();
  const install = useInstallPlugin();
  const uninstall = useUninstallPlugin();
  const [searchQuery, setSearchQuery] = useState('');
  const mutating = toggle.isMutating || install.isMutating || uninstall.isMutating;

  const missingRuntimes = new Set<string>();
  if (runtimes != null) {
    const runtimeEntries = Object.entries(runtimes);
    for (let i = 0, len = runtimeEntries.length; i < len; i++) {
      const [kind, runtime] = runtimeEntries[i];
      if (runtime.status === 'missing') missingRuntimes.add(kind);
    }
  }

  const groupsFor = (installed: boolean) =>
    data === undefined
      ? undefined
      : pluginProviderGroups(data, { installed }).map((group) => ({
          ...group,
          plugins: filterPluginCards(group.plugins, searchQuery),
        }));
  const installedGroups = groupsFor(true);
  const marketGroups = groupsFor(false);

  // Fold the single re-listed plugin into the cache instead of revalidating: a full mutate() would
  // re-run the expensive CLI discovery. Install/uninstall need nothing extra — the Plugins/Market
  // split is derived from `installations`, so the replaced entry moves tabs on its own.
  const patchPlugin = (updated: Plugin | undefined): void => {
    if (updated === undefined) return;
    void mutate(
      (current) =>
        current && {
          ...current,
          plugins: current.plugins.map((plugin) => replaceIfSame(plugin, updated)),
        },
      { revalidate: false },
    );
  };

  const onToggleSkill = async (row: SkillRowView, enabled: boolean): Promise<void> => {
    if (row.pluginKey === undefined) {
      // A standalone skill has its own provider mechanism (claude `skillOverrides`, codex
      // `skills/config/write`); the reply carries the re-read skill.
      const updated = await toggleSkill.trigger({
        provider: row.provider,
        skillId: row.skillId,
        path: row.path,
        scope: row.standaloneScope,
        enabled,
      });
      void mutate(
        (current) =>
          current && {
            ...current,
            standaloneSkills: current.standaloneSkills.map((skill) =>
              skill.provider === updated.provider && skill.path === updated.path ? updated : skill,
            ),
          },
        { revalidate: false },
      );
    }
  };

  const onToggleInstallation = async (
    card: PluginCardView,
    scope: PluginScope | undefined,
    enabled: boolean,
  ): Promise<void> => {
    const updated = await toggle.trigger({ provider: card.provider, id: card.id, enabled, scope });
    patchPlugin(updated.plugin);
  };

  const onInstall = async (card: PluginCardView): Promise<void> => {
    const result = await install.trigger({ provider: card.provider, id: card.id });
    patchPlugin(result.plugin);
    // Most codex plugins are `ON_INSTALL`: the install lands but its apps stay unauthorized, and
    // LinkCode has no OAuth flow — say so rather than let it read as finished.
    if (result.pendingAuthApps && result.pendingAuthApps.length > 0) {
      toastManager.add({
        title: t('installNeedsAuthTitle', { title: card.title }),
        description: t('installNeedsAuth', { apps: result.pendingAuthApps.join('、') }),
      });
    }
  };

  const onUninstall = async (card: PluginCardView): Promise<void> => {
    const result = await uninstall.trigger({ provider: card.provider, id: card.id });
    patchPlugin(result.plugin);
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
          busy={mutating}
          groups={installedGroups}
          missingRuntimes={missingRuntimes}
          searchQuery={searchQuery}
          variant="installed"
          onToggleInstallation={(card, scope, enabled) => {
            void onToggleInstallation(card, scope, enabled).catch(noop);
          }}
          onInstall={(card) => {
            void onInstall(card).catch(noop);
          }}
          onUninstall={(card) => {
            void onUninstall(card).catch(noop);
          }}
        />
      }
      marketTab={
        <PluginsTab
          busy={mutating}
          groups={marketGroups}
          missingRuntimes={missingRuntimes}
          searchQuery={searchQuery}
          variant="market"
          onToggleInstallation={(card, scope, enabled) => {
            void onToggleInstallation(card, scope, enabled).catch(noop);
          }}
          onInstall={(card) => {
            void onInstall(card).catch(noop);
          }}
          onUninstall={(card) => {
            void onUninstall(card).catch(noop);
          }}
        />
      }
      mcpTab={<McpTab pluginRows={data === undefined ? [] : pluginMcpServerRows(data.plugins)} />}
      linkcodeTab={<LinkCodeMarketTab searchQuery={searchQuery} />}
      skillsTab={
        <SkillsTab
          busy={mutating || toggleSkill.isMutating}
          rows={data === undefined ? undefined : skillRows(data)}
          searchQuery={searchQuery}
          onToggle={(row, enabled) => {
            void onToggleSkill(row, enabled).catch(noop);
          }}
        />
      }
    />
  );
}

function replaceIfSame(plugin: Plugin, updated: Plugin): Plugin {
  return plugin.provider === updated.provider && plugin.id === updated.id ? updated : plugin;
}
