import type { ConfigNetwork, ConfigPlatform, ConfigStorage } from '@linkcode/common/config';

const LEADING_SLASH_PATTERN = /^\//;

export interface ConfigFetchResponse {
  readonly headers: { get(name: string): string | null };
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type ConfigFetch = (
  url: string,
  init: { readonly headers: Readonly<Record<string, string>> },
) => Promise<ConfigFetchResponse>;

export interface AtomicKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function createConfigNetwork(baseUrl: string, fetch: ConfigFetch): ConfigNetwork {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return {
    async get(path, request) {
      const headers: Record<string, string> = {};
      if (request.etag) headers['If-None-Match'] = request.etag;
      const response = await fetch(new URL(path.replace(LEADING_SLASH_PATTERN, ''), root).href, {
        headers,
      });
      return {
        status: response.status,
        ...(response.status !== 304 && { body: new Uint8Array(await response.arrayBuffer()) }),
        ...(response.headers.get('etag') && { etag: response.headers.get('etag') ?? undefined }),
      };
    },
  };
}

export function createConfigStorage(storage: AtomicKeyValueStorage): ConfigStorage {
  return {
    get: (key) => storage.getItem(key),
    set: (key, value) => storage.setItem(key, value),
  };
}

export function resolveMobileConfigPlatform(
  platform: string,
): Extract<ConfigPlatform, 'android' | 'ios'> | null {
  return platform === 'ios' || platform === 'android' ? platform : null;
}
