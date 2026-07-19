import type { AccountProtocol, EndpointModel } from '@linkcode/schema';

/**
 * The add-account form's "fetch model list" step: query an endpoint's model-listing API on the
 * client's behalf (renderers cannot reach arbitrary user endpoints — desktop CSP, browser CORS).
 * Listings are best-effort: many gateways serve none (404) — the caller surfaces the rejection
 * and the form falls back to manual entry.
 */

export interface ListEndpointModelsRequest {
  baseUrl: string;
  protocol: AccountProtocol;
  secret: string;
  credentialType: 'api-key' | 'auth-token';
}

const TIMEOUT_MS = 10_000;

/** OpenAI-shaped bases already end in a version segment (`…/v1`); Anthropic bases do not. */
function listingUrl(baseUrl: string, protocol: AccountProtocol): string {
  const base = baseUrl.replace(/\/+$/, '');
  return protocol === 'anthropic' ? `${base}/v1/models` : `${base}/models`;
}

function listingHeaders(req: ListEndpointModelsRequest): Record<string, string> {
  if (req.protocol === 'anthropic') {
    return {
      'anthropic-version': '2023-06-01',
      ...(req.credentialType === 'api-key'
        ? { 'x-api-key': req.secret }
        : { Authorization: `Bearer ${req.secret}` }),
    };
  }
  return { Authorization: `Bearer ${req.secret}` };
}

/** Both OpenAI- and Anthropic-shaped listings return `{data: [{id, …}]}`; OpenRouter adds
 * `context_length`. Anything else is a shape error. */
function parseListing(payload: unknown): EndpointModel[] {
  if (typeof payload !== 'object' || payload === null || !('data' in payload)) {
    throw new Error('unexpected response shape (no "data" array)');
  }
  const { data } = payload;
  if (!Array.isArray(data)) throw new Error('unexpected response shape (no "data" array)');
  const models: EndpointModel[] = [];
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue;
    const id = (entry as Record<string, unknown>).id;
    if (typeof id !== 'string' || id.length === 0) continue;
    const contextLength = (entry as Record<string, unknown>).context_length;
    models.push({
      id,
      ...(typeof contextLength === 'number' &&
        Number.isInteger(contextLength) &&
        contextLength > 0 && { contextWindow: contextLength }),
    });
  }
  return models;
}

export async function listEndpointModels(
  req: ListEndpointModelsRequest,
  fetchFn: typeof fetch = fetch,
): Promise<EndpointModel[]> {
  const response = await fetchFn(listingUrl(req.baseUrl, req.protocol), {
    headers: listingHeaders(req),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`the endpoint answered ${response.status} — it may not serve a model listing`);
  }
  return parseListing(await response.json());
}
