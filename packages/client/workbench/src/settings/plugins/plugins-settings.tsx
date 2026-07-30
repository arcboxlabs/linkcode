import type { Plugin, PluginScope } from '@linkcode/schema';
import type { PluginCardView, SkillRowView } from '@linkcode/ui';
import { PluginsShell, PluginsTab, SkillsTab } from '@linkcode/ui';
import { useState } from 'react';
import { useAgentRuntimes } from '../../agent-runtime/hooks';
import { usePlugins, useSetPluginEnabled, useSetSkillEnabled } from './hooks';
import { McpTab } from './mcp-settings';
import { filterPluginCards, pluginMcpServerRows, pluginProviderGroups, skillRows } from './view';

/**
 * The plugins/MCP/skills settings page container. Transport-backed — it must render inside
 * `WorkbenchProviders`, but may sit above the connection gate, degrading to loading while the
 * daemon is unreachable. Discovery is a CLI shell-out, so refresh is manual only.
 */
export function PluginsSettingsPanel(): React.ReactNode {
  const { data, isLoading, isValidating, mutate } = usePlugins();
  const { data: runtimes } = useAgentRuntimes();
  const toggle = useSetPluginEnabled();
  const toggleSkill = useSetSkillEnabled();
  const [searchQuery, setSearchQuery] = useState('');

  const missingRuntimes = new Set<string>();
  for (const [kind, runtime] of Object.entries(runtimes ?? {})) {
    if (runtime.status === 'missing') missingRuntimes.add(kind);
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
      if (updated === undefined) return;
      void mutate(
        (current) =>
          current && {
            ...current,
            standaloneSkills: current.standaloneSkills.map((skill) =>
              skill.provider === updated.provider && skill.id === updated.id ? updated : skill,
            ),
          },
        { revalidate: false },
      );
      return;
    }
    const separator = row.pluginKey.indexOf(':');
    const provider = row.pluginKey.slice(0, separator);
    if (provider !== 'claude-code' && provider !== 'codex') return;
    const updated = await toggle.trigger({
      provider,
      id: row.pluginKey.slice(separator + 1),
      enabled,
    });
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
          groups={installedGroups}
          missingRuntimes={missingRuntimes}
          searchQuery={searchQuery}
          variant="installed"
          onToggleInstallation={(card, scope, enabled) => {
            void onToggleInstallation(card, scope, enabled);
          }}
        />
      }
      marketTab={
        <PluginsTab
          busy={toggle.isMutating}
          groups={marketGroups}
          missingRuntimes={missingRuntimes}
          searchQuery={searchQuery}
          variant="market"
          onToggleInstallation={(card, scope, enabled) => {
            void onToggleInstallation(card, scope, enabled);
          }}
        />
      }
      mcpTab={<McpTab pluginRows={data === undefined ? [] : pluginMcpServerRows(data.plugins)} />}
      skillsTab={
        <SkillsTab
          busy={toggle.isMutating || toggleSkill.isMutating}
          rows={data === undefined ? undefined : skillRows(data)}
          searchQuery={searchQuery}
          onToggle={(row, enabled) => {
            void onToggleSkill(row, enabled);
          }}
        />
      }
    />
  );
}

function replaceIfSame(plugin: Plugin, updated: Plugin): Plugin {
  return plugin.provider === updated.provider && plugin.id === updated.id ? updated : plugin;
}
