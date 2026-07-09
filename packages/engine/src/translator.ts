import type { StartOptions } from '@linkcode/schema';

/**
 * Local Anthropic⇄OpenAI translation for cross-protocol accounts (see docs/ARCHITECTURE.md and the
 * `arcboxlabs/aigateway` sidecar). When an account's endpoint speaks a different wire than the agent,
 * the daemon spawns a loopback translator and points the agent at it; a bare Engine injects none, so a
 * session that needs translation fails clearly rather than silently mis-routing.
 */

/** A cross-protocol upstream the local translation sidecar should serve. */
export interface TranslatorUpstream {
  /** OpenAI-compatible upstream base URL (e.g. `https://api.openai.com/v1`). */
  baseUrl: string;
  /** Upstream API key; the sidecar injects it as an `Authorization: Bearer` header. */
  apiKey: string;
  /** Upstream wire. The sidecar currently implements only `openai-chat`. */
  wire: 'openai-chat';
  /** Fallback upstream model when the inbound model has no mapping. */
  model?: string;
}

/** A local translation sidecar keyed by upstream; the daemon supplies the implementation. */
export interface TranslatorService {
  /** Ensure a loopback translator for this upstream; resolves to its base URL (`http://127.0.0.1:PORT`). */
  ensure(upstream: TranslatorUpstream): Promise<string>;
  /** Stop every translator process (daemon shutdown). */
  closeAll(): Promise<void>;
}

/** Placeholder bearer token for claude-code talking to the local translator, which ignores inbound
 *  auth (the real upstream key lives in the sidecar's config, never in the agent env). */
export const TRANSLATOR_PLACEHOLDER_TOKEN = 'linkcode-translator';

/**
 * The upstream a session's resolved account needs translated, or undefined for native routing.
 * v1: only claude-code (which speaks the Anthropic Messages wire inbound) over an `openai-chat`
 * endpoint is translatable — the sidecar serves `POST /v1/messages` and forwards to an OpenAI Chat
 * Completions upstream. Native-protocol accounts and unsupported combinations route directly.
 */
export function translationUpstream(opts: StartOptions): TranslatorUpstream | undefined {
  if (opts.kind !== 'claude-code') return undefined;
  const config = opts.config;
  if (config?.protocol !== 'openai-chat') return undefined;
  const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : undefined;
  const apiKey =
    typeof config.apiKey === 'string'
      ? config.apiKey
      : typeof config.authToken === 'string'
        ? config.authToken
        : undefined;
  if (!baseUrl || !apiKey) return undefined;
  return { baseUrl, apiKey, wire: 'openai-chat', ...(opts.model && { model: opts.model }) };
}

/**
 * Rewrite resolved StartOptions so claude-code speaks native Anthropic to the local translator: the
 * base URL becomes the sidecar's loopback URL, the protocol becomes anthropic, and the real key is
 * dropped from the agent env (it lives in the sidecar config) in favour of the placeholder token.
 */
export function withTranslatorEndpoint(opts: StartOptions, url: string): StartOptions {
  return {
    ...opts,
    config: {
      ...opts.config,
      baseUrl: url,
      protocol: 'anthropic',
      authToken: TRANSLATOR_PLACEHOLDER_TOKEN,
      apiKey: undefined,
    },
  };
}
