import type {
  PluginAvailability,
  PluginComponentKind,
  PluginProvider,
  PluginScope,
  StandaloneSkillScope,
} from '@linkcode/schema';

/** View-models for the plugins/MCP/skills settings page. Derived by the workbench data plane
 * (`@linkcode/workbench` settings/plugins/view.ts); presentation renders them verbatim. */

export interface PluginInstallationRow {
  scope: PluginScope | undefined;
  enabled: boolean;
  version: string | undefined;
  /** Per-plugin management capability; the switch renders only when true. */
  canToggle: boolean;
}

export interface PluginCardView {
  /** `${provider}:${id}` — stable across re-sorts and refreshes. */
  key: string;
  provider: PluginProvider;
  id: string;
  title: string;
  description: string | undefined;
  version: string | undefined;
  marketplaceLabel: string | undefined;
  availability: PluginAvailability;
  installed: boolean;
  /** Per-plugin management capabilities; an action renders only when its capability is true. */
  canInstall: boolean;
  canUninstall: boolean;
  installations: PluginInstallationRow[];
  componentCounts: Partial<Record<PluginComponentKind, number>>;
  /** Precomputed lowercase haystack for the client-side filter. */
  searchText: string;
}

export interface PluginProviderGroup {
  provider: PluginProvider;
  /** Discovery for this provider failed (CLI missing/broken) — not the same as zero plugins. */
  discoveryFailed: boolean;
  failureReason: string | undefined;
  plugins: PluginCardView[];
}

export interface SkillRowView {
  key: string;
  provider: PluginProvider;
  /** Provider-side identity for the toggle: claude keys by name, codex by SKILL.md path. */
  skillId: string;
  path: string;
  /** Present for plugin-bundled skills; undefined for standalone ones. */
  pluginKey: string | undefined;
  pluginTitle: string | undefined;
  name: string;
  description: string | undefined;
  enabled: boolean;
  /** Only standalone skills can currently toggle individually. */
  canToggle: boolean;
  standaloneScope: StandaloneSkillScope | undefined;
  searchText: string;
}

export interface PluginMcpServerRow {
  key: string;
  provider: PluginProvider;
  pluginTitle: string;
  serverName: string;
  enabled: boolean;
}

export interface CustomMcpServerRow {
  id: string;
  name: string;
  transport: 'stdio' | 'http';
  /** Command (stdio) or URL (http) — the row's secondary line. */
  detail: string;
  enabled: boolean;
  secretKeys: string[];
}
