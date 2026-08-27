import { resolve as resolvePath } from 'node:path';
import type { AgentKind, McpServer, McpWarning, SessionId, StartOptions } from '@linkcode/schema';
import { Effect } from 'effect';
import { isObjectEmpty } from 'foxts/is-object-empty';
import type { CustomMcpServerService } from '../agent/custom-mcp-service';
import type { ProviderConfigStore } from '../agent/provider-config';
import { applyProviderDefaults } from '../agent/provider-config';
import type { TranslatorService } from '../agent/translator';
import { translationUpstream, withTranslatorEndpoint } from '../agent/translator';
import { OperationError, RequestError } from '../failure';
import type { LinkCodePluginStore } from '../plugin/linkcode-store';
import type { PluginService } from '../plugin/service';
import type { SimulatorMcpProvider } from '../simulator/mcp';
import { MCP_CAPABLE_AGENT_KINDS, SIMULATOR_MCP_SERVER_NAME } from './mcp-capability';

export interface ResolvedStartOptions {
  readonly options: StartOptions;
  /** The account backing this run, recorded per run so a relaunch stays on it. */
  readonly accountId?: string;
  /** Custom-MCP injection advisories, delivered on the `session.started` reply. */
  readonly warnings: McpWarning[];
}

/** Resolves daemon-owned provider defaults, enabled custom MCP servers, the optional
 * cross-protocol translation endpoint, and the per-session simulator MCP injection. */
export class SessionStartOptionsResolver {
  constructor(
    private readonly providers: ProviderConfigStore,
    private readonly translator: TranslatorService | undefined,
    private readonly simulatorMcp?: SimulatorMcpProvider,
    private readonly customMcp?: CustomMcpServerService,
    private readonly plugins?: PluginService,
    private readonly linkCodePluginStore?: LinkCodePluginStore,
  ) {}

  resolve(
    options: StartOptions,
    sessionId: SessionId,
  ): Effect.Effect<ResolvedStartOptions, RequestError | OperationError> {
    const providers = this.providers.get();
    const defaults = applyProviderDefaults(options, providers, this.providers.getAccounts());
    // Whether an account actually resolved — the request's pick or, failing that, the agent's
    // configured default. Asking that rather than "is a default set" also covers a pinned session
    // on an agent with no default at all.
    const { accountId } = defaults;
    const account = accountId === undefined ? {} : { accountId };
    const { translator } = this;
    const withCustomMcpServers = this.withCustomMcpServers.bind(this);
    const withSimulatorMcp = this.withSimulatorMcp.bind(this);
    const withPluginMcpServers = this.withPluginMcpServers.bind(this);
    return Effect.gen(function* () {
      if (defaults.unavailable) {
        // Starting anyway would point the agent at an endpoint it cannot speak, which surfaces
        // much later as an opaque 404 from the provider.
        return yield* Effect.fail(
          new RequestError({
            code: 'unsupported',
            message: `The account cannot back ${options.kind} (${defaults.unavailable})`,
          }),
        );
      }
      if (accountId !== undefined && defaults.options.model === undefined) {
        // With an account in play, its selected set is the only model source and nothing falls back
        // to the agent's own choice. Agents with no account keep resolving their own.
        return yield* Effect.fail(
          new RequestError({
            code: 'unsupported',
            message: `No model selected for ${options.kind}`,
          }),
        );
      }
      const custom = yield* withCustomMcpServers(defaults.options);
      const pluginInjected = yield* withPluginMcpServers(custom.options, custom.warnings);
      const resolved = withSimulatorMcp(pluginInjected.options, sessionId);
      const upstream = translationUpstream(resolved);
      if (!upstream) return { options: resolved, ...account, warnings: pluginInjected.warnings };
      if (!translator) {
        return yield* Effect.fail(
          new RequestError({
            code: 'unsupported',
            message: 'Cross-protocol translation is unavailable',
          }),
        );
      }
      const url = yield* Effect.tryPromise({
        try: () => translator.ensure(upstream),
        catch: (cause) =>
          new OperationError({
            subsystem: 'translator',
            operation: 'translator.ensure',
            publicMessage: 'Failed to start cross-protocol translation',
            cause,
          }),
      });
      return {
        options: withTranslatorEndpoint(resolved, url),
        ...account,
        warnings: custom.warnings,
      };
    });
  }

  /** The server names `resolve` would inject for this kind, as a hint for cold history reads:
   * injected servers never appear in the agent's own config, so a replayed MCP call cannot
   * resolve its server without this set. */
  injectedMcpServerNames(kind: AgentKind): string[] {
    if (!MCP_CAPABLE_AGENT_KINDS.has(kind)) return [];
    const names = (this.customMcp?.listEnabled() ?? []).map((entry) => entry.server.name);
    if (this.simulatorMcp) names.push(SIMULATOR_MCP_SERVER_NAME);
    if (this.linkCodePluginStore) {
      for (const entry of this.linkCodePluginStore.list()) {
        if (!entry.installed.enabled) continue;
        for (const component of entry.manifest.components) {
          if (component.kind === 'mcp-server') names.push(component.name);
        }
      }
    }
    return names;
  }

  /** Fold enabled custom MCP servers into the session's server list, warning instead of
   * silently dropping: unsupported agent kinds and name collisions are user-visible facts. */
  private withCustomMcpServers(
    options: StartOptions,
  ): Effect.Effect<{ options: StartOptions; warnings: McpWarning[] }> {
    const warnings: McpWarning[] = [];
    const enabled = this.customMcp?.listEnabled() ?? [];
    if (enabled.length === 0) return Effect.succeed({ options, warnings });
    if (!MCP_CAPABLE_AGENT_KINDS.has(options.kind)) {
      for (const entry of enabled) {
        warnings.push({ serverName: entry.server.name, reason: 'agent-unsupported' });
      }
      return Effect.succeed({ options, warnings });
    }
    const pluginNames =
      options.kind === 'codex' && this.plugins
        ? this.plugins
            .enabledMcpServerNames('codex', { cwd: options.cwd })
            .pipe(Effect.match({ onSuccess: (names) => names, onFailure: () => null }))
        : Effect.succeed(new Set<string>());
    return pluginNames.pipe(
      Effect.map((names) => {
        const servers = [...(options.mcpServers ?? [])];
        for (const entry of enabled) {
          if (names === null) {
            warnings.push({
              serverName: entry.server.name,
              reason: 'provider-preflight-failed',
            });
            continue;
          }
          if (
            options.kind === 'codex' &&
            entry.server.type === 'http' &&
            entry.server.headers !== undefined &&
            !isObjectEmpty(entry.server.headers)
          ) {
            warnings.push({ serverName: entry.server.name, reason: 'provider-unsupported' });
            continue;
          }
          if (
            names.has(entry.server.name) ||
            servers.some((server) => server.name === entry.server.name)
          ) {
            warnings.push({ serverName: entry.server.name, reason: 'name-conflict' });
            continue;
          }
          servers.push(entry.server);
        }
        return {
          options:
            servers.length === 0 && options.mcpServers === undefined
              ? options
              : { ...options, mcpServers: servers },
          warnings,
        };
      }),
    );
  }

  /** Fold enabled LinkCode plugin mcp-server components into the session's server list, resolving
   * each component's `env` mapping against the plugin's stored settings. Same warning contract as
   * custom-MCP — an unsupported agent, a failed Codex preflight, or a name collision is a
   * user-visible advisory, not a drop — including Codex's shared, un-namespaced MCP space, where
   * an enabled native plugin of the same name would be silently overridden. */
  private withPluginMcpServers(
    options: StartOptions,
    warnings: McpWarning[],
  ): Effect.Effect<{ options: StartOptions; warnings: McpWarning[] }> {
    const store = this.linkCodePluginStore;
    if (store === undefined) return Effect.succeed({ options, warnings });
    const entries = store.list().filter((entry) => entry.installed.enabled);
    if (entries.length === 0) return Effect.succeed({ options, warnings });
    if (!MCP_CAPABLE_AGENT_KINDS.has(options.kind)) {
      for (const entry of entries) {
        for (const component of entry.manifest.components) {
          if (component.kind === 'mcp-server') {
            warnings.push({ serverName: component.name, reason: 'agent-unsupported' });
          }
        }
      }
      return Effect.succeed({ options, warnings });
    }
    const pluginNames =
      options.kind === 'codex' && this.plugins
        ? this.plugins
            .enabledMcpServerNames('codex', { cwd: options.cwd })
            .pipe(Effect.match({ onSuccess: (names) => names, onFailure: () => null }))
        : Effect.succeed(new Set<string>());
    return Effect.map(pluginNames, (names) => {
      const servers = [...(options.mcpServers ?? [])];
      for (const entry of entries) {
        const settings = store.getSettings(entry.installed.id);
        for (const component of entry.manifest.components) {
          if (component.kind !== 'mcp-server') continue;
          if (names === null) {
            // Without the native name set an override cannot be ruled out — skip, don't inject.
            warnings.push({ serverName: component.name, reason: 'provider-preflight-failed' });
            continue;
          }
          if (
            names.has(component.name) ||
            servers.some((server) => server.name === component.name)
          ) {
            warnings.push({ serverName: component.name, reason: 'name-conflict' });
            continue;
          }
          const env: Record<string, string> = {};
          if (component.env) {
            for (const [envVar, settingId] of Object.entries(component.env)) {
              if (settingId in settings) env[envVar] = String(settings[settingId]);
            }
          }
          // No missing-config advisory yet: shipped clients validate `reason` against the old enum
          // and would drop the whole session.started frame, so emission waits for a tolerant floor.
          const server: McpServer = {
            type: 'stdio',
            name: component.name,
            command: component.command,
            ...(component.entry && {
              args: [resolvePath(entry.installed.path, component.entry), ...(component.args ?? [])],
            }),
            ...(!component.entry && component.args && { args: component.args }),
            ...(!isObjectEmpty(env) && { env }),
          };
          servers.push(server);
        }
      }
      return {
        options:
          servers.length === 0 && options.mcpServers === undefined
            ? options
            : { ...options, mcpServers: servers },
        warnings,
      };
    });
  }

  /** Append the session's simulator MCP endpoint for agents whose SDK can consume it. */
  private withSimulatorMcp(options: StartOptions, sessionId: SessionId): StartOptions {
    if (!this.simulatorMcp || !MCP_CAPABLE_AGENT_KINDS.has(options.kind)) return options;
    const endpoint = this.simulatorMcp.endpointFor(sessionId);
    if (!endpoint) return options;
    const existing = options.mcpServers ?? [];
    // Never shadow a user-configured server of the same name: many SDKs key servers by name and let
    // the last one win, so appending ours would silently replace theirs. If the user already claims
    // the name, leave their config untouched (the token is released with the session).
    if (existing.some((server) => server.name === endpoint.name)) return options;
    return { ...options, mcpServers: [...existing, endpoint] };
  }
}
