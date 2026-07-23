import type {
  AgentEvent,
  McpPluginCatalog,
  McpPluginServer,
  McpServer,
  PluginConfig,
  StartOptions,
} from '@linkcode/schema';
import { AGENT_MCP_CAPABLE, mcpPluginServerName } from '@linkcode/schema';
import { Effect } from 'effect';
import { nullthrow } from 'foxts/guard';
import type { ProviderConfigStore } from '../agent/provider-config';
import { applyProviderDefaults } from '../agent/provider-config';
import type { TranslatorService } from '../agent/translator';
import { translationUpstream, withTranslatorEndpoint } from '../agent/translator';
import { OperationError, RequestError } from '../failure';
import { MCP_PLUGIN_CATALOG } from '../plugin/catalog';

type PluginWarning = Extract<AgentEvent, { type: 'plugin-warning' }>;

export interface ResolvedStartOptions {
  options: StartOptions;
  warnings: PluginWarning[];
}

/** Resolves daemon-owned provider defaults and the optional cross-protocol translation endpoint. */
export class SessionStartOptionsResolver {
  constructor(
    private readonly providers: ProviderConfigStore,
    private readonly translator: TranslatorService | undefined,
    private readonly pluginCatalog: McpPluginCatalog = MCP_PLUGIN_CATALOG,
  ) {}

  resolve(
    options: StartOptions,
  ): Effect.Effect<ResolvedStartOptions, RequestError | OperationError> {
    const plugins = resolvePluginServers(options, this.providers.getPlugins(), this.pluginCatalog);
    const providerResolved = applyProviderDefaults(
      plugins.options,
      this.providers.get(),
      this.providers.getAccounts(),
    );
    const resolved = { ...plugins, options: providerResolved };
    const upstream = translationUpstream(resolved.options);
    if (!upstream) return Effect.succeed(resolved);
    if (!this.translator) {
      return Effect.fail(
        new RequestError({
          code: 'unsupported',
          message: 'Cross-protocol translation is unavailable',
        }),
      );
    }
    const translator = this.translator;
    return Effect.tryPromise({
      try: () => translator.ensure(upstream),
      catch: (cause) =>
        new OperationError({
          subsystem: 'translator',
          operation: 'translator.ensure',
          publicMessage: 'Failed to start cross-protocol translation',
          cause,
        }),
    }).pipe(
      Effect.map((url) => ({
        ...resolved,
        options: withTranslatorEndpoint(resolved.options, url),
      })),
    );
  }
}

export function resolvePluginServers(
  options: StartOptions,
  config: PluginConfig,
  catalog: McpPluginCatalog = MCP_PLUGIN_CATALOG,
  now: number = Date.now(),
): ResolvedStartOptions {
  const warnings: PluginWarning[] = [];
  const clientServers = options.mcpServers ?? [];
  const clientNames = new Set(clientServers.map((server) => server.name));
  const pluginServers: McpServer[] = [];
  const catalogById = new Map(catalog.map((descriptor) => [descriptor.id, descriptor]));

  for (const unit of config.units) {
    if (!unit.enabled) continue;
    const descriptor = catalogById.get(unit.unitId);
    if (!descriptor) {
      warnings.push({ type: 'plugin-warning', unitId: unit.unitId, reason: 'unsatisfied-binding' });
      continue;
    }
    if (!AGENT_MCP_CAPABLE[options.kind]) {
      warnings.push({
        type: 'plugin-warning',
        unitId: unit.unitId,
        reason: 'unsupported-transport',
      });
      continue;
    }
    // A plugin composes several servers; each resolves independently, so one unsatisfied service
    // dependency degrades the unit to a warning without dropping its satisfied servers.
    for (const entry of descriptor.servers) {
      if (clientNames.has(mcpPluginServerName(entry))) continue;
      if (entry.type === 'managed') {
        // Managed servers only exist through the CODE-96 broker.
        warnings.push({
          type: 'plugin-warning',
          unitId: unit.unitId,
          service: entry.service,
          reason: 'broker-unavailable',
        });
        continue;
      }
      if (entry.credentialSlots.length === 0) {
        pluginServers.push(entry.server);
        continue;
      }
      // Credential slots require a service (schema-enforced); route through its binding.
      const service = nullthrow(entry.service, 'credential slots require a service');
      const binding = config.serviceBindings[service];
      if (!binding) {
        warnings.push({
          type: 'plugin-warning',
          unitId: unit.unitId,
          service,
          reason: 'unsatisfied-binding',
        });
        continue;
      }
      if (binding.type === 'managed') {
        warnings.push({
          type: 'plugin-warning',
          unitId: unit.unitId,
          service,
          reason: 'broker-unavailable',
        });
        continue;
      }
      const connector = config.connectors.find(
        (candidate) => candidate.id === binding.connectorId && candidate.service === service,
      );
      if (!connector) {
        warnings.push({
          type: 'plugin-warning',
          unitId: unit.unitId,
          service,
          reason: 'unsatisfied-binding',
        });
        continue;
      }
      const expiresAt = connector.credential.expiresAt;
      if (expiresAt !== undefined && expiresAt <= now) {
        // A declaredly expired secret would only fail downstream as an opaque MCP auth error;
        // skipping with a typed reason keeps the diagnostic attributable.
        warnings.push({
          type: 'plugin-warning',
          unitId: unit.unitId,
          service,
          reason: 'expired-credential',
        });
        continue;
      }
      pluginServers.push(injectCredential(entry, connector.credential.secret));
    }
  }

  return {
    options:
      pluginServers.length === 0
        ? options
        : { ...options, mcpServers: [...clientServers, ...pluginServers] },
    warnings,
  };
}

function injectCredential(
  entry: Extract<McpPluginServer, { type: 'preset' }>,
  secret: string,
): McpServer {
  const server = entry.server;
  const slots = Object.fromEntries(entry.credentialSlots.map((slot) => [slot.name, secret]));
  if (server.type === 'stdio') {
    return { ...server, env: { ...server.env, ...slots } };
  }
  return { ...server, headers: { ...server.headers, ...slots } };
}
