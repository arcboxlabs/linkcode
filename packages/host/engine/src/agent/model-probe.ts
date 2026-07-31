import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { AccountEndpoint, AccountModel, AccountSecret } from '@linkcode/schema';
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
 */

const PROBE_TIMEOUT_MS = 10000;
const ANTHROPIC_VERSION = '2023-06-01';
const ERROR_BODY_LIMIT = 200;
const RESPONSE_BODY_LIMIT = 1024 * 1024;
const MODEL_LIMIT = 10000;
const TRAILING_SLASH_PATTERN = /\/+$/;
const BLOCKED_IPV4 = new BlockList();
const BLOCKED_IPV6 = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_IPV4.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::', 96],
  ['::ffff:0:0', 96],
  ['::ffff:0:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2001::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fec0::', 10],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_IPV6.addSubnet(network, prefix, 'ipv6');
}

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

export function modelListUrl(endpoint: AccountEndpoint): string {
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
  endpoint: AccountEndpoint,
  secret: AccountSecret,
): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (endpoint.protocol === 'anthropic') {
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

function isBlockedAddress(address: LookupAddress): boolean {
  return address.family === 4
    ? BLOCKED_IPV4.check(address.address, 'ipv4')
    : BLOCKED_IPV6.check(address.address, 'ipv6');
}

export async function resolvePublicEndpoint(
  url: URL,
  lookup: typeof dnsLookup = dnsLookup,
): Promise<LookupAddress> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Model detection requires an HTTP(S) endpoint');
  }
  const hostname = normalizedHostname(url);
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new Error('Model detection cannot access private or non-routable addresses');
  }
  return addresses[0];
}

export async function requestPublicModelList(
  url: URL,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<ModelListResponse> {
  const address = await withAbort(resolvePublicEndpoint(url), signal);
  return requestModelListAtAddress(url, headers, address, signal);
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    void promise
      .then((value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      })
      .catch((error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(normalizeError(error, 'Model endpoint resolution failed'));
      });
  });
}

function normalizeError(error: unknown, fallback: string): Error {
  return new Error(extractErrorMessage(error, false) ?? fallback);
}

function abortReason(signal: AbortSignal): Error {
  return normalizeError(signal.reason, 'Model detection aborted');
}

export function requestModelListAtAddress(
  url: URL,
  headers: Record<string, string>,
  address: LookupAddress,
  signal?: AbortSignal,
): Promise<ModelListResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseEnded = false;
    const settleError = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(normalizeError(error, 'Model-list request failed'));
    };
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
      {
        hostname: address.address,
        family: address.family,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { ...headers, host: url.host },
        ...(url.protocol === 'https:' && { servername: normalizedHostname(url) }),
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

/** Model ids the endpoint advertises, deduped, in the order it listed them. Rejects with a
 * user-facing message (status + the vendor's own reason) — the dialog shows it verbatim. */
export async function probeEndpointModels(
  endpoint: AccountEndpoint,
  secret: AccountSecret,
  request: ModelListRequest = requestPublicModelList,
): Promise<AccountModel[]> {
  const url = new URL(modelListUrl(endpoint));
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error('Model detection timed out'));
  }, PROBE_TIMEOUT_MS);
  let response: ModelListResponse;
  try {
    response = await request(url, modelListHeaders(endpoint, secret), controller.signal);
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
