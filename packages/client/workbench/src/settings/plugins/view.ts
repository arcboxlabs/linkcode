import type {
  LinkCodePluginConfigView,
  PluginList,
  PluginMarketReleaseEntry,
} from '@linkcode/client-core';
// The narrow `config/semver` subpath, never the `config` barrel: the barrel re-exports crypto
// (@noble/*, with a top-level side effect), ConfigCore, and telemetry into this renderer bundle.
import { compareSemverStrings, isPrereleaseSemver } from '@linkcode/common/config/semver';
import type { Plugin, PluginComponentKind, StandaloneSkill } from '@linkcode/schema';
import type {
  LinkCodeCatalogCardView,
  LinkCodeInstalledPluginRow,
  PluginCardView,
  PluginMcpServerRow,
  PluginProviderGroup,
  SkillRowView,
} from '@linkcode/ui';
import { isObjectEmpty } from 'foxts/is-object-empty';

/** Pure projections from the discovery result to presentation view-models. No React, no I/O. */

export type {
  LinkCodeCatalogCardView,
  LinkCodeInstalledPluginRow,
  PluginCardView,
  PluginMcpServerRow,
  PluginProviderGroup,
  SkillRowView,
};

export function pluginCardView(plugin: Plugin): PluginCardView {
  const title = plugin.displayName ?? plugin.name;
  const componentCounts: Partial<Record<PluginComponentKind, number>> = {};
  for (const component of plugin.components) {
    componentCounts[component.kind] = (componentCounts[component.kind] ?? 0) + 1;
  }
  const available = plugin.availability === 'available';
  const canToggle =
    available && plugin.managementCapabilities.enable && plugin.managementCapabilities.disable;
  return {
    key: `${plugin.provider}:${plugin.id}`,
    provider: plugin.provider,
    id: plugin.id,
    title,
    description: plugin.description,
    version: plugin.installations.find((entry) => entry.version)?.version ?? plugin.version,
    marketplaceLabel: plugin.marketplace?.displayName ?? plugin.marketplace?.name,
    availability: plugin.availability,
    installed: plugin.installations.length > 0,
    canInstall: available && plugin.managementCapabilities.install,
    canUninstall: plugin.managementCapabilities.uninstall,
    installations: plugin.installations.map((entry) => ({
      scope: entry.scope,
      enabled: entry.enabled,
      version: entry.version,
      canToggle: canToggle && (entry.scope === undefined || entry.scope === 'user'),
    })),
    componentCounts,
    searchText: [
      plugin.id,
      title,
      plugin.description ?? '',
      ...plugin.keywords,
      ...plugin.components.map((component) => component.name),
    ]
      .join('\n')
      .toLowerCase(),
  };
}

/**
 * Group cards by provider in the discovery result's provider order, folding in per-provider
 * failure state so an empty group renders "discovery failed", not a bare empty state.
 *
 * `installed` partitions the catalog: the Plugins tab shows what this host actually has, the
 * Market tab shows the rest (on a real machine that is hundreds of marketplace listings).
 */
export function pluginProviderGroups(
  list: PluginList,
  opts: { installed: boolean },
): PluginProviderGroup[] {
  return list.providerStatus.map((status) => {
    const plugins: PluginCardView[] = [];
    for (const plugin of list.plugins) {
      if (plugin.provider !== status.provider) continue;
      if (plugin.installations.length > 0 !== opts.installed) continue;
      plugins.push(pluginCardView(plugin));
    }
    return {
      provider: status.provider,
      discoveryFailed: !status.ok,
      failureReason: status.reason,
      plugins,
    };
  });
}

export function filterPluginCards(
  cards: readonly PluginCardView[],
  query: string,
): PluginCardView[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...cards];
  return cards.filter((card) => card.searchText.includes(needle));
}

/** Plugin-bundled skills (installed plugins only) followed by standalone skills. */
export function skillRows(list: PluginList): SkillRowView[] {
  const rows: SkillRowView[] = [];
  for (const plugin of list.plugins) {
    if (plugin.installations.length === 0) continue;
    const card = pluginCardView(plugin);
    const skills = plugin.components.filter((component) => component.kind === 'skill');
    const pluginEnabled =
      plugin.installations.length === 1
        ? plugin.installations[0].enabled
        : plugin.installations.some((entry) => entry.enabled);
    for (const skill of skills) {
      rows.push({
        key: `${card.key}:${skill.name}`,
        provider: plugin.provider,
        skillId: skill.name,
        path: '',
        pluginKey: card.key,
        pluginTitle: card.title,
        name: skill.name,
        description: skill.description,
        enabled: skill.enabled ?? pluginEnabled,
        canToggle: false,
        standaloneScope: undefined,
        searchText: `${skill.name}\n${skill.description ?? ''}\n${card.title}`.toLowerCase(),
      });
    }
  }
  for (const skill of list.standaloneSkills) {
    rows.push(standaloneSkillRow(skill));
  }
  return rows;
}

function standaloneSkillRow(skill: StandaloneSkill): SkillRowView {
  return {
    key: `${skill.provider}:standalone:${skill.path}`,
    provider: skill.provider,
    skillId: skill.id,
    path: skill.path,
    pluginKey: undefined,
    pluginTitle: undefined,
    name: skill.name,
    description: skill.description,
    enabled: skill.enabled,
    canToggle: skill.toggleable,
    standaloneScope: skill.scope,
    searchText: `${skill.name}\n${skill.description ?? ''}`.toLowerCase(),
  };
}

/** Read-only projection of plugin-provided MCP servers for the MCP tab's lower section. */
export function pluginMcpServerRows(plugins: readonly Plugin[]): PluginMcpServerRow[] {
  const rows: PluginMcpServerRow[] = [];
  for (const plugin of plugins) {
    if (plugin.installations.length === 0) continue;
    const title = plugin.displayName ?? plugin.name;
    const pluginEnabled = plugin.installations.some((entry) => entry.enabled);
    for (const component of plugin.components) {
      if (component.kind !== 'mcp-server') continue;
      rows.push({
        key: `${plugin.provider}:${plugin.id}:${component.name}`,
        provider: plugin.provider,
        pluginTitle: title,
        serverName: component.name,
        enabled: component.enabled ?? pluginEnabled,
      });
    }
  }
  return rows;
}

/** The plugin id's name segment — the masked config read carries no display name. */
function linkcodePluginTitle(pluginId: string): string {
  return pluginId.split('/').at(-1) ?? pluginId;
}

/** A marketplace release entry to its catalog card. `installedVersion` is the version on disk for
 * this plugin id, if any: an exact match renders installed, an older one renders as an upgrade
 * (the daemon's install replaces the older package and keeps its settings). Never call this
 * directly from the catalog — go through {@link linkcodeCatalogCards} so one plugin renders one
 * card (its latest release), not one card per published version. */
function linkcodeCatalogCard(
  marketplaceId: string,
  entry: PluginMarketReleaseEntry,
  installedVersion: string | undefined,
): LinkCodeCatalogCardView {
  const manifest = entry.release.manifest;
  const title = manifest.displayName ?? linkcodePluginTitle(entry.pluginId);
  const age =
    installedVersion === undefined
      ? null
      : comparePluginVersions(installedVersion, manifest.version);
  return {
    key: `${marketplaceId}:${entry.pluginId}`,
    marketplaceId,
    pluginId: entry.pluginId,
    version: manifest.version,
    title,
    description: manifest.description,
    installed: age === 0,
    updateAvailable: age !== null && age < 0,
    installedNewer: age !== null && age > 0,
    searchText: [entry.pluginId, title, manifest.description ?? '', ...manifest.keywords]
      .join('\n')
      .toLowerCase(),
  };
}

/** One card per plugin id, for its newest release: a marketplace that keeps old releases listed
 * must not fill the catalog with one card per version, and an "update" badge must never point at a
 * version older than the installed one. Stability outranks version order, so a published
 * `2.0.0-beta.1` cannot hide the `1.9.0` everyone should actually install; a plugin whose only
 * releases are prereleases still gets its card. */
export function linkcodeCatalogCards(
  marketplaceId: string,
  releases: readonly PluginMarketReleaseEntry[],
  installedVersions: ReadonlyMap<string, string>,
): LinkCodeCatalogCardView[] {
  const newestByPlugin = new Map<string, PluginMarketReleaseEntry>();
  for (const entry of releases) {
    const current = newestByPlugin.get(entry.pluginId);
    if (current === undefined || outranks(entry, current)) {
      newestByPlugin.set(entry.pluginId, entry);
    }
  }
  return [...newestByPlugin.values()].map((entry) =>
    linkcodeCatalogCard(marketplaceId, entry, installedVersions.get(entry.pluginId)),
  );
}

/** Whether `candidate` should replace `current` as the plugin's catalog card. */
function outranks(candidate: PluginMarketReleaseEntry, current: PluginMarketReleaseEntry): boolean {
  const candidateVersion = candidate.release.manifest.version;
  const currentVersion = current.release.manifest.version;
  const candidatePrerelease = isPrereleaseSemver(candidateVersion);
  if (candidatePrerelease !== isPrereleaseSemver(currentVersion)) return !candidatePrerelease;
  return comparePluginVersions(candidateVersion, currentVersion) > 0;
}

/** semver compare over the schema-validated plugin version shape; an unparseable value can only
 * arrive from a corrupt index, where string order is the honest fallback. */
function comparePluginVersions(a: string, b: string): number {
  return compareSemverStrings(a, b) ?? (a === b ? 0 : a < b ? -1 : 1);
}

/** A masked plugin config read to its installed-list row. */
export function linkcodeInstalledRow(view: LinkCodePluginConfigView): LinkCodeInstalledPluginRow {
  return {
    key: view.id,
    pluginId: view.id,
    title: linkcodePluginTitle(view.id),
    version: view.version,
    hasSettings: !isObjectEmpty(view.settings),
  };
}

export function filterLinkCodeCatalogCards(
  cards: readonly LinkCodeCatalogCardView[],
  query: string,
): LinkCodeCatalogCardView[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...cards];
  return cards.filter((card) => card.searchText.includes(needle));
}
