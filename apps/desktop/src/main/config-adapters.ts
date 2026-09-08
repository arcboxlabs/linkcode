import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConfigCrypto, ConfigNetwork, ConfigStorage } from '@linkcode/common/config';
import { MAX_SNAPSHOT_SIZE_BYTES } from '@linkcode/common/config';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const LEADING_SLASHES_RE = /^\/+/;

export class AtomicConfigStorage implements ConfigStorage {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(this.#path(key), 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
    const destination = this.#path(key);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(value, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  #path(key: string): string {
    return join(this.#directory, `${Buffer.from(key).toString('base64url')}.json`);
  }
}

export class FetchConfigNetwork implements ConfigNetwork {
  readonly #endpoint: URL;

  constructor(endpoint: string) {
    this.#endpoint = new URL(endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
    if (
      this.#endpoint.username ||
      this.#endpoint.password ||
      this.#endpoint.search ||
      this.#endpoint.hash
    ) {
      throw new TypeError('Config endpoint must not contain credentials, query, or fragment');
    }
  }

  async get(path: string, request: { readonly etag?: string }) {
    const url = new URL(path.replace(LEADING_SLASHES_RE, ''), this.#endpoint);
    if (url.origin !== this.#endpoint.origin || !url.pathname.startsWith(this.#endpoint.pathname)) {
      throw new TypeError('Config path escaped endpoint');
    }
    const response = await fetch(url, {
      headers: request.etag ? { 'If-None-Match': request.etag } : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    const etag = response.headers.get('etag') ?? undefined;
    if (response.status !== 200) {
      await response.body?.cancel();
      return { status: response.status, ...(etag && { etag }) };
    }
    return {
      body: await readBoundedBody(response),
      status: response.status,
      ...(etag && { etag }),
    };
  }
}

export const nodeConfigCrypto: ConfigCrypto = {
  randomUuid: randomUUID,
  sha256(bytes) {
    return Promise.resolve(new Uint8Array(createHash('sha256').update(bytes).digest()));
  },
  verifyEd25519(publicKey, signature, message) {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
      format: 'der',
      type: 'spki',
    });
    return Promise.resolve(verify(null, message, key, signature));
  },
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

async function readBoundedBody(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SNAPSHOT_SIZE_BYTES) {
    await response.body?.cancel();
    throw new TypeError('Config response exceeds maximum size');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      // Streaming must be consumed serially so the byte ceiling applies before buffering more.
      // eslint-disable-next-line no-await-in-loop -- the next chunk is read only after checking this one
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_SNAPSHOT_SIZE_BYTES) {
        // eslint-disable-next-line no-await-in-loop -- cancel settles before the error escapes
        await reader.cancel();
        throw new TypeError('Config response exceeds maximum size');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (let i = 0, len = chunks.length; i < len; i++) {
    const chunk = chunks[i];
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
