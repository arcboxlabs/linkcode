import type {
  AgentKind,
  McpPluginCatalog,
  McpPluginId,
  McpPluginService,
  PluginConfigPublic,
  PluginConnectorPublic,
} from '@linkcode/schema';
import { AGENT_MCP_CAPABLE, AgentKindSchema, mcpPluginServerName } from '@linkcode/schema';

/**
 * Presentation-ready plugin state, derived purely from the catalog and the public config. The
 * daemon does not persist resolution warnings, so the settings surface derives the same verdicts
 * the resolver would reach — the reason vocabulary intentionally matches `PluginWarningReason`.
 */

/** Agent kinds whose sessions accept plugin MCP servers (per-unit refinement is CODE-93's). */
export const MCP_APPLICABLE_AGENTS: readonly AgentKind[] = AgentKindSchema.options.filter(
  (kind) => AGENT_MCP_CAPABLE[kind],
);

/** Credential-source state of one service, shared by every plugin server that names it. */
export type PluginServiceStatus =
  | { kind: 'unbound' }
  /** Bound to the HQ broker; live connected/expired state composes from CODE-94, not here. */
  | { kind: 'managed' }
  | { kind: 'local'; connector: PluginConnectorPublic; expired: boolean }
  /** The binding references a connector that no longer exists or serves another service. */
  | { kind: 'local-missing'; connectorId: string };

export type PluginServerStatus =
  /** Preset with no credential dependency — injects as-is. */
  | 'ready'
  /** Local credential bound and configured. */
  | 'satisfied'
  /** Non-usable states, named exactly like the `PluginWarningReason` the resolver would emit. */
  | 'expired-credential'
  | 'unsatisfied-binding'
  | 'broker-unavailable';

export interface PluginUnitServerView {
  name: string;
  service?: McpPluginService;
  status: PluginServerStatus;
}

export type PluginUnitStatus = 'disabled' | 'ready' | 'partial' | 'unavailable';

export interface PluginUnitView {
  id: McpPluginId;
  labelKey: McpPluginCatalog[number]['labelKey'];
  descriptionKey: McpPluginCatalog[number]['descriptionKey'];
  enabled: boolean;
  /** Distinct services the unit's servers depend on, in server order. */
  services: McpPluginService[];
  servers: PluginUnitServerView[];
  status: PluginUnitStatus;
}

export interface PluginServiceView {
  service: McpPluginService;
  status: PluginServiceStatus;
  /** Catalog units with at least one server on this service — they share its binding. */
  usedByUnits: McpPluginId[];
}

export function pluginServiceStatus(
  service: McpPluginService,
  config: PluginConfigPublic,
  now: number,
): PluginServiceStatus {
  const binding = config.serviceBindings[service];
  if (!binding) return { kind: 'unbound' };
  if (binding.type === 'managed') return { kind: 'managed' };
  const connector = config.connectors.find(
    (candidate) => candidate.id === binding.connectorId && candidate.service === service,
  );
  if (!connector) return { kind: 'local-missing', connectorId: binding.connectorId };
  const expiresAt = connector.credential.expiresAt;
  return { kind: 'local', connector, expired: expiresAt !== undefined && expiresAt <= now };
}

function serverStatus(
  server: McpPluginCatalog[number]['servers'][number],
  config: PluginConfigPublic,
  now: number,
): PluginServerStatus {
  // Managed servers only materialize through the CODE-96 broker.
  if (server.type === 'managed') return 'broker-unavailable';
  if (server.credentialSlots.length === 0 || server.service === undefined) return 'ready';
  const status = pluginServiceStatus(server.service, config, now);
  switch (status.kind) {
    case 'local':
      return status.expired ? 'expired-credential' : 'satisfied';
    case 'managed':
      return 'broker-unavailable';
    default:
      return 'unsatisfied-binding';
  }
}

function unitStatus(enabled: boolean, servers: readonly PluginUnitServerView[]): PluginUnitStatus {
  if (!enabled) return 'disabled';
  const usable = servers.filter(
    (server) => server.status === 'ready' || server.status === 'satisfied',
  ).length;
  if (usable === servers.length) return 'ready';
  return usable > 0 ? 'partial' : 'unavailable';
}

export function pluginUnitViews(
  catalog: McpPluginCatalog,
  config: PluginConfigPublic,
  now: number,
): PluginUnitView[] {
  const enabledById = new Map(config.units.map((unit) => [unit.unitId, unit.enabled]));
  return catalog.map((descriptor) => {
    const servers = descriptor.servers.map((server) => ({
      name: mcpPluginServerName(server),
      service: server.service,
      status: serverStatus(server, config, now),
    }));
    const enabled = enabledById.get(descriptor.id) ?? false;
    return {
      id: descriptor.id,
      labelKey: descriptor.labelKey,
      descriptionKey: descriptor.descriptionKey,
      enabled,
      services: [...new Set(servers.flatMap((server) => server.service ?? []))],
      servers,
      status: unitStatus(enabled, servers),
    };
  });
}

export function pluginServiceViews(
  catalog: McpPluginCatalog,
  config: PluginConfigPublic,
  now: number,
): PluginServiceView[] {
  const usedBy = new Map<McpPluginService, McpPluginId[]>();
  for (const descriptor of catalog) {
    for (const server of descriptor.servers) {
      if (server.service === undefined) continue;
      const units = usedBy.get(server.service) ?? [];
      if (!units.includes(descriptor.id)) units.push(descriptor.id);
      usedBy.set(server.service, units);
    }
  }
  return [...usedBy].map(([service, usedByUnits]) => ({
    service,
    status: pluginServiceStatus(service, config, now),
    usedByUnits,
  }));
}
