import type { AccountEndpoint, AccountModel, AccountSecret } from '@linkcode/schema';
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
/** Trim of an error body kept for the user-facing message — enough to read a vendor's reason. */
const ERROR_BODY_LIMIT = 200;
const TRAILING_SLASH_PATTERN = /\/+$/;

/** Tolerant of a relay that answers a bare array instead of the vendors' `{data}` envelope. */
const ModelListSchema = z.union([
  z.object({ data: z.array(z.object({ id: z.string(), display_name: z.string().optional() })) }),
  z.array(z.object({ id: z.string(), display_name: z.string().optional() })),
]);

export function modelListUrl(endpoint: AccountEndpoint): string {
  const base = endpoint.baseUrl.replace(TRAILING_SLASH_PATTERN, '');
  return endpoint.protocol === 'anthropic' ? `${base}/v1/models?limit=1000` : `${base}/models`;
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

/** Model ids the endpoint advertises, deduped, in the order it listed them. Rejects with a
 * user-facing message (status + the vendor's own reason) — the dialog shows it verbatim. */
export async function probeEndpointModels(
  endpoint: AccountEndpoint,
  secret: AccountSecret,
  fetchImpl: typeof fetch = fetch,
): Promise<AccountModel[]> {
  const url = modelListUrl(endpoint);
  const response = await fetchImpl(url, {
    headers: modelListHeaders(endpoint, secret),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).trim().slice(0, ERROR_BODY_LIMIT);
    throw new Error(`${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`);
  }
  const parsed = ModelListSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`${url} did not answer a model list`);
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
