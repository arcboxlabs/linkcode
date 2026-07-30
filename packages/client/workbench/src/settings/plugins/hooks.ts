import {
  getCustomMcpServers,
  getPlugins,
  installPlugin,
  setCustomMcpServers,
  setPluginEnabled,
  setSkillEnabled,
  uninstallPlugin,
} from '@linkcode/sdk';
import { useData, useMutation } from '../../runtime/tayori';

/**
 * Provider-plugin + standalone-skill discovery. The daemon shells out to the agent CLIs (codex
 * bounds one pass at 30s), so this deliberately never revalidates on focus/reconnect — the page
 * offers a manual refresh (`mutate()`) instead, and a toggle patches its single entry via
 * `mutate(map, { revalidate: false })` rather than re-running discovery.
 *
 * Settings is a global surface with no active-workspace concept, so discovery runs without a
 * `cwd`; project-scoped marketplaces and skills intentionally don't appear here.
 */
export function usePlugins() {
  return useData(getPlugins, {}, { revalidateOnFocus: false, revalidateOnReconnect: false });
}

export function useSetPluginEnabled() {
  return useMutation(setPluginEnabled);
}

export function useSetSkillEnabled() {
  return useMutation(setSkillEnabled);
}

/** Install/uninstall run through the provider (codex: `plugin/install`, a real network + disk
 * operation), so they are explicit user actions with no optimistic UI. */
export function useInstallPlugin() {
  return useMutation(installPlugin);
}

export function useUninstallPlugin() {
  return useMutation(uninstallPlugin);
}

/** Masked custom MCP servers; cheap config read, normal trigger-then-revalidate rhythm. */
export function useCustomMcpServers() {
  return useData(getCustomMcpServers, {});
}

export function useSetCustomMcpServers() {
  return useMutation(setCustomMcpServers);
}
