import type { SessionId, StartOptions } from '@linkcode/schema';
import { Effect } from 'effect';
import type { ProviderConfigStore } from '../agent/provider-config';
import { applyProviderDefaults } from '../agent/provider-config';
import type { TranslatorService } from '../agent/translator';
import { translationUpstream, withTranslatorEndpoint } from '../agent/translator';
import { OperationError, RequestError } from '../failure';
import type { SimulatorMcpProvider } from '../simulator/mcp';
import { MCP_CAPABLE_AGENT_KINDS } from '../simulator/mcp';

/** Resolves daemon-owned provider defaults, the optional cross-protocol translation endpoint,
 * and the per-session simulator MCP injection for MCP-capable agents. */
export class SessionStartOptionsResolver {
  constructor(
    private readonly providers: ProviderConfigStore,
    private readonly translator: TranslatorService | undefined,
    private readonly simulatorMcp?: SimulatorMcpProvider,
  ) {}

  resolve(
    options: StartOptions,
    sessionId: SessionId,
  ): Effect.Effect<StartOptions, RequestError | OperationError> {
    const resolved = this.withSimulatorMcp(
      applyProviderDefaults(options, this.providers.get(), this.providers.getAccounts()),
      sessionId,
    );
    const upstream = translationUpstream(resolved);
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
    }).pipe(Effect.map((url) => withTranslatorEndpoint(resolved, url)));
  }

  /** Append the session's simulator MCP endpoint for agents whose SDK can consume it. */
  private withSimulatorMcp(options: StartOptions, sessionId: SessionId): StartOptions {
    if (!this.simulatorMcp || !MCP_CAPABLE_AGENT_KINDS.has(options.kind)) return options;
    const endpoint = this.simulatorMcp.endpointFor(sessionId);
    if (!endpoint) return options;
    return { ...options, mcpServers: [...(options.mcpServers ?? []), endpoint] };
  }
}
