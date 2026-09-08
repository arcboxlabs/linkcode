import type { StartOptions } from '@linkcode/schema';
import { isObjectEmpty } from 'foxts/is-object-empty';

/**
 * Credential/endpoint bundle the engine resolves from a session's bound account into
 * `StartOptions.config`; each adapter maps it onto its own auth mechanism. All fields optional —
 * an `oauth` account contributes none, delegating to the agent CLI's own login store.
 */
export interface AgentCredential {
  /** Provider key (x-api-key style). */
  apiKey?: string;
  /** Bearer token (e.g. a gateway token). */
  authToken?: string;
  /** Custom endpoint (gateway / relay / local translator). */
  baseUrl?: string;
  /** This endpoint's id in the agent's own provider catalog, when it has one. Provider-routed
   * agents (opencode, pi) inject the credential under it instead of guessing a provider. */
  knownProvider?: string;
  /** Endpoint params under the env names that provider entry reads them by. Present means the agent
   * builds its own per-model URL, so `baseUrl` must not be injected — one URL cannot serve a
   * provider whose models sit on different routes. */
  providerEnv?: Record<string, string>;
  /** Extra environment for the agent process. */
  extraEnv?: Record<string, string>;
}

/** Read the resolved credential bundle from a session's free-form `config` bag. */
export function readAgentCredential(config: StartOptions['config']): AgentCredential {
  if (!config) return {};
  const extraEnv = readStringRecord(config.extraEnv);
  const providerEnv = readStringRecord(config.providerEnv);
  return {
    apiKey: readString(config.apiKey),
    authToken: readString(config.authToken),
    baseUrl: readString(config.baseUrl),
    knownProvider: readString(config.knownProvider),
    ...(providerEnv && { providerEnv }),
    ...(extraEnv && { extraEnv }),
  };
}

/**
 * Build the `env` for the claude-code subprocess. The SDK `env` **replaces** the process
 * environment, so `base` is spread to preserve PATH/HOME; undefined when the account contributes
 * nothing. With an `authToken`, `ANTHROPIC_API_KEY` is blanked — Claude Code prefers a non-empty key
 * over the token, so a leftover inherited key would silently defeat a bearer-token gateway.
 */
export function claudeCodeEnv(
  base: Record<string, string | undefined>,
  cred: AgentCredential,
): Record<string, string | undefined> | undefined {
  const { apiKey, authToken, baseUrl, extraEnv } = cred;
  if (!apiKey && !authToken && !baseUrl && !extraEnv) return undefined;
  const env: Record<string, string | undefined> = { ...base };
  if (authToken) {
    env.ANTHROPIC_AUTH_TOKEN = authToken;
    env.ANTHROPIC_API_KEY = '';
  } else if (apiKey) {
    env.ANTHROPIC_API_KEY = apiKey;
  }
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;
  if (extraEnv) Object.assign(env, extraEnv);
  return env;
}

/**
 * Build the account-specific `env` for the codex app-server subprocess. The adapter merges this
 * over the resolved project environment; undefined when nothing is contributed.
 */
export function codexEnv(cred: AgentCredential): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  const key = cred.apiKey ?? cred.authToken;
  if (key) env.CODEX_API_KEY = key;
  if (cred.baseUrl) env.OPENAI_BASE_URL = cred.baseUrl;
  if (cred.extraEnv) Object.assign(env, cred.extraEnv);
  return isObjectEmpty(env) ? undefined : env;
}

/**
 * Extra env for the Grok Build headless CLI. The runner merges this over the inherited env so
 * OAuth/login still reads `~/.grok/auth.json` when no key is present. An account key becomes
 * `XAI_API_KEY` (Grok's API-key auth path).
 */
export function grokEnv(cred: AgentCredential): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  const key = cred.apiKey ?? cred.authToken;
  if (key) env.XAI_API_KEY = key;
  if (cred.extraEnv) Object.assign(env, cred.extraEnv);
  return isObjectEmpty(env) ? undefined : env;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  const entries = Object.entries(value);
  for (let i = 0, len = entries.length; i < len; i++) {
    const [key, val] = entries[i];
    if (typeof val === 'string') out[key] = val;
  }
  return isObjectEmpty(out) ? undefined : out;
}
