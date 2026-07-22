import type {
  AgentEvent,
  McpPluginCatalog,
  McpServer,
  PluginConfig,
  StartOptions,
} from '@linkcode/schema';
import { Effect } from 'effect';
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

const MCP_CAPABLE_AGENTS = new Set(['claude-code', 'codex', 'opencode']);

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
): ResolvedStartOptions {
  const warnings: PluginWarning[] = [];
  const clientServers = options.mcpServers ?? [];
  const clientNames = new Set(clientServers.map((server) => server.name));
  const pluginServers: McpServer[] = [];
  const catalogById = new Map(catalog.map((descriptor) => [descriptor.id, descriptor]));

  for (const unit of config.units) {
    if (!unit.enabled) continue;
    const descriptor = catalogById.get(unit.unitId);
    const binding = unit.binding;
    if (!descriptor || !binding) {
      warnings.push({ type: 'plugin-warning', unitId: unit.unitId, reason: 'unsatisfied-binding' });
      continue;
    }
    if (!MCP_CAPABLE_AGENTS.has(options.kind)) {
      warnings.push({
        type: 'plugin-warning',
        unitId: unit.unitId,
        reason: 'unsupported-transport',
      });
      continue;
    }
    const serverName =
      descriptor.backing.type === 'preset'
        ? descriptor.backing.server.name
        : descriptor.backing.name;
    if (clientNames.has(serverName)) continue;
    if (binding.type === 'managed') {
      warnings.push({ type: 'plugin-warning', unitId: unit.unitId, reason: 'broker-unavailable' });
      continue;
    }
    const connector = config.connectors.find(
      (entry) => entry.id === binding.connectorId && entry.service === descriptor.service,
    );
    if (!connector) {
      warnings.push({ type: 'plugin-warning', unitId: unit.unitId, reason: 'unsatisfied-binding' });
      continue;
    }
    if (descriptor.backing.type === 'managed-connector') {
      warnings.push({ type: 'plugin-warning', unitId: unit.unitId, reason: 'broker-unavailable' });
      continue;
    }
    pluginServers.push(injectCredential(descriptor.backing, connector.credential.secret));
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
  backing: Extract<McpPluginCatalog[number]['backing'], { type: 'preset' }>,
  secret: string,
): McpServer {
  const server = backing.server;
  if (server.type === 'stdio') {
    return {
      ...server,
      env: {
        ...server.env,
        ...Object.fromEntries(backing.credentialSlots.map((slot) => [slot.name, secret])),
      },
    };
  }
  return {
    ...server,
    headers: {
      ...server.headers,
      ...Object.fromEntries(backing.credentialSlots.map((slot) => [slot.name, secret])),
    },
  };
}
