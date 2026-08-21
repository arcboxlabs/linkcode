import type { Agent as HttpAgent } from 'node:http';
import { request as httpRequest } from 'node:http';
import type { Agent as HttpsAgent } from 'node:https';
import { request as httpsRequest } from 'node:https';
import type { ServiceModelList } from '@linkcode/providers';
import type { AccountEndpoint, AccountModel, AccountSecret } from '@linkcode/schema';
import {
  AntiSSRFError,
  AntiSSRFPolicy,
  IPAddressRanges,
  PolicyConfigOptions,
} from '@microsoft/antissrf';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { z } from 'zod';

/**
 * Reads what an endpoint (gateway / relay / direct vendor API) actually serves, so the account
 * forms can offer a real model list instead of a free-text field. The daemon owns this call: it
 * holds the secret, and the renderer's CSP blocks remote fetches anyway.
 *
 * Endpoint facts (2026-07): OpenAI-shaped `baseUrl`s already end in `/v1`, Anthropic-shaped ones
 * are the bare origin — hence the two different model-list paths below. Both answer
 * `{data:[{id,…}]}`; Anthropic adds `display_name` and paginates (one 1000-entry page is every
 * model any vendor currently serves).
 *
 * **Network boundary.** The URL can be free text, so the daemon must not become a probe of the
 * user's own network. `@microsoft/antissrf` supplies the denied ranges — a table that tracks IANA
 * registries and covers far more than loopback/RFC1918 (cloud metadata, Azure wireserver, AS112,
 * SRv6, Teredo) — and enforces them inside the agent's DNS lookup, so the checked address is the
 * one the socket connects to and a rebind between check and connect has no gap to land in.
 *
 * The one range class re-permitted is the one an RFC forbids real hosts from occupying (2544
 * benchmarking, 5737/3849 documentation). Nothing routable lives there, so a *name* resolving into
 * it can only be a local resolver's placeholder — which is exactly what a fake-IP tunnel (Clash,
 * sing-box, Surge) hands out for every hostname it proxies. Denying that class buys no protection
 * and strands every user behind such a tunnel; connecting to the placeholder is what hands the
 * request back to the tunnel that minted it.
 */

const PROBE_TIMEOUT_MS = 10000;
const ANTHROPIC_VERSION = '2023-06-01';
const ERROR_BODY_LIMIT = 200;
const RESPONSE_BODY_LIMIT = 1024 * 1024;
const MODEL_LIMIT = 10000;
const TRAILING_SLASH_PATTERN = /\/+$/;
/** Both refusal kinds the policy raises — a denied address, and plaintext HTTP carrying a secret. */
const POLICY_REFUSAL = 'Model detection only reaches public HTTPS endpoints';

export const PROBE_POLICY = new AntiSSRFPolicy(PolicyConfigOptions.ExternalOnlyLatest);
// `fc00::/18` is sing-box's IPv6 pool; RFC 4193 leaves that half unassigned, so real ULA
// deployments (Tailscale, Docker) sit in `fd00::/8` and stay denied.
PROBE_POLICY.addAllowedAddresses([
  ...IPAddressRanges.benchmarking,
  ...IPAddressRanges.documentation,
  'fc00::/18',
]);
const PROBE_HTTPS_AGENT = PROBE_POLICY.getHttpsAgent();
const PROBE_HTTP_AGENT = PROBE_POLICY.getHttpAgent();

/** Tolerant of a relay that answers a bare array instead of the vendors' `{data}` envelope. */
const ModelEntrySchema = z.object({
  id: z.string().min(1).max(512),
  display_name: z.string().max(1024).optional(),
});
const ModelListSchema = z.union([
  z.object({ data: z.array(ModelEntrySchema).max(MODEL_LIMIT) }),
  z.array(ModelEntrySchema).max(MODEL_LIMIT),
]);

interface ModelListResponse {
  status: number;
  statusText: string;
  body: string;
}

export type ModelListRequest = (
  url: URL,
  headers: Record<string, string>,
  signal?: AbortSignal,
) => Promise<ModelListResponse>;
export type ModelProbe = typeof probeEndpointModels;

/** A custom account names its own endpoint, so its list path can only be guessed from the protocol.
 * Catalog services never come through here — they carry an explicit URL (`@linkcode/providers`). */
export function modelListUrlFromEndpoint(endpoint: AccountEndpoint): string {
  const url = new URL(endpoint.baseUrl);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Model detection endpoint cannot contain credentials, a query, or a fragment');
  }
  const basePath = url.pathname.replace(TRAILING_SLASH_PATTERN, '');
  url.pathname = endpoint.protocol === 'anthropic' ? `${basePath}/v1/models` : `${basePath}/models`;
  if (endpoint.protocol === 'anthropic') url.searchParams.set('limit', '1000');
  return url.href;
}

export function modelListHeaders(
  wire: ServiceModelList['wire'],
  secret: AccountSecret,
): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (wire === 'anthropic') {
    headers['anthropic-version'] = ANTHROPIC_VERSION;
    // An Anthropic-shaped gateway authenticates with whichever header its own credential is.
    if (secret.type === 'api-key') headers['x-api-key'] = secret.key;
    else headers.authorization = `Bearer ${secret.token}`;
    return headers;
  }
  headers.authorization = `Bearer ${secret.type === 'api-key' ? secret.key : secret.token}`;
  return headers;
}

function normalizedHostname(url: URL): string {
  return url.hostname[0] === '[' ? url.hostname.slice(1, -1) : url.hostname;
}

function normalizeError(error: unknown, fallback: string): Error {
  if (error instanceof AntiSSRFError) return new Error(POLICY_REFUSAL);
  return new Error(extractErrorMessage(error, false) ?? fallback);
}

function abortReason(signal: AbortSignal): Error {
  return normalizeError(signal.reason, 'Model detection aborted');
}

/** `agent` is the network boundary; overriding it is for tests that drive the transport itself. */
export function requestPublicModelList(
  url: URL,
  headers: Record<string, string>,
  signal?: AbortSignal,
  agent?: HttpAgent | HttpsAgent,
): Promise<ModelListResponse> {
  return new Promise((resolve, reject) => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new Error('Model detection requires an HTTP(S) endpoint'));
      return;
    }
    let settled = false;
    let responseEnded = false;
    const settleError = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(normalizeError(error, 'Model-list request failed'));
    };
    const secure = url.protocol === 'https:';
    const request = (secure ? httpsRequest : httpRequest)(
      {
        hostname: normalizedHostname(url),
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers,
        agent: agent ?? (secure ? PROBE_HTTPS_AGENT : PROBE_HTTP_AGENT),
        signal,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const limit = status >= 200 && status < 300 ? RESPONSE_BODY_LIMIT : ERROR_BODY_LIMIT;
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) {
            const error = new Error(`Model-list response exceeded ${limit} bytes`);
            settleError(error);
            response.destroy(error);
            request.destroy(error);
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          settled = true;
          responseEnded = true;
          resolve({
            status,
            statusText: response.statusMessage ?? '',
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        response.on('aborted', () => settleError(new Error('Model-list response was interrupted')));
        response.on('error', settleError);
        response.on('close', () => {
          if (!responseEnded && !response.complete) {
            settleError(new Error('Model-list response was interrupted'));
          }
        });
      },
    );
    request.on('error', (error) => settleError(signal?.aborted ? abortReason(signal) : error));
    request.end();
  });
}

/** Model ids the source advertises, deduped, in the order it listed them. Rejects with a
 * user-facing message (status + the vendor's own reason) — the dialog shows it verbatim. */
export async function probeEndpointModels(
  source: ServiceModelList,
  secret: AccountSecret,
  request: ModelListRequest = requestPublicModelList,
): Promise<AccountModel[]> {
  const url = new URL(source.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('Model detection timed out'));
  }, PROBE_TIMEOUT_MS);
  let response: ModelListResponse;
  try {
    response = await request(url, modelListHeaders(source.wire, secret), controller.signal);
  } finally {
    clearTimeout(timeout);
  }
  if (response.status < 200 || response.status >= 300) {
    const body = response.body.trim().slice(0, ERROR_BODY_LIMIT);
    throw new Error(`${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(response.body);
  } catch {
    throw new Error(`${url.href} did not answer a model list`);
  }
  const parsed = ModelListSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${url.href} did not answer a model list`);
  const entries = Array.isArray(parsed.data) ? parsed.data : parsed.data.data;
  const byId = new Map<string, AccountModel>();
  for (const entry of entries) {
    if (entry.id && !byId.has(entry.id)) {
      byId.set(entry.id, {
        id: entry.id,
        ...(entry.display_name && { label: entry.display_name }),
      });
    }
  }
  return [...byId.values()];
}
