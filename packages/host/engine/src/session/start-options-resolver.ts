import type { McpWarning, SessionId, StartOptions } from '@linkcode/schema';
import { Effect } from 'effect';
import { isObjectEmpty } from 'foxts/is-object-empty';
import type { CustomMcpServerService } from '../agent/custom-mcp-service';
import type { ProviderConfigStore } from '../agent/provider-config';
import { applyProviderDefaults, resolvedAccountId } from '../agent/provider-config';
import type { TranslatorService } from '../agent/translator';
import { translationUpstream, withTranslatorEndpoint } from '../agent/translator';
import { OperationError, RequestError } from '../failure';
import type { PluginService } from '../plugin/service';
import type { SimulatorMcpProvider } from '../simulator/mcp';
import { MCP_CAPABLE_AGENT_KINDS } from './mcp-capability';

export interface ResolvedStartOptions {
  readonly options: StartOptions;
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
  ) {}

  resolve(
    options: StartOptions,
    sessionId: SessionId,
  ): Effect.Effect<ResolvedStartOptions, RequestError | OperationError> {
    const providers = this.providers.get();
    const defaults = applyProviderDefaults(options, providers, this.providers.getAccounts());
    // Whether an account actually resolved — the caller's pin or, failing that, the agent's
    // configured default. Asking that rather than "is a default set" also covers a pinned session
    // on an agent with no default at all.
    const accountResolved = resolvedAccountId(defaults.options) !== undefined;
    const { translator } = this;
    const withCustomMcpServers = this.withCustomMcpServers.bind(this);
    const withSimulatorMcp = this.withSimulatorMcp.bind(this);
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
      if (accountResolved && defaults.options.model === undefined) {
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
      const resolved = withSimulatorMcp(custom.options, sessionId);
      const upstream = translationUpstream(resolved);
      if (!upstream) return { options: resolved, warnings: custom.warnings };
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
        warnings: custom.warnings,
      };
    });
  }

  /** Fold enabled custom MCP servers into the session's server list, warning instead of
   * silently dropping: unsupported agent kinds and name collisions are user-visible facts. */
  private withCustomMcpServers(options: StartOptions): Effect.Effect<ResolvedStartOptions> {
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
