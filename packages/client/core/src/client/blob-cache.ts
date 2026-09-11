import { nullthrow } from 'foxts/guard';

/** Decoded bytes this cache will hold before evicting the least recently read blob. */
export const ATTACHMENT_CACHE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Decoded attachment bytes keyed by content-addressed `blobId`. Blobs are immutable, so a hit is
 * always correct; the byte budget exists because this cache outlives every session it serves.
 */
export class AttachmentBlobCache {
  private readonly blobs = new Map<string, Uint8Array>();
  private totalBytes = 0;

  constructor(private readonly maxBytes: number = ATTACHMENT_CACHE_MAX_BYTES) {}

  get(blobId: string): Uint8Array | undefined {
    const bytes = this.blobs.get(blobId);
    // Map iterates in insertion order, so re-inserting a hit makes eviction least-recently-used.
    if (bytes) {
      this.blobs.delete(blobId);
      this.blobs.set(blobId, bytes);
    }
    return bytes;
  }

  set(blobId: string, bytes: Uint8Array): void {
    const previous = this.blobs.get(blobId);
    if (previous) this.totalBytes -= previous.byteLength;
    this.blobs.delete(blobId);
    this.blobs.set(blobId, bytes);
    this.totalBytes += bytes.byteLength;
    for (const [oldest, stale] of this.blobs) {
      if (oldest === blobId || this.totalBytes <= this.maxBytes) break;
      this.blobs.delete(oldest);
      this.totalBytes -= stale.byteLength;
    }
  }

  has(blobId: string): boolean {
    return this.blobs.has(blobId);
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  const nodeBuffer = (
    globalThis as { Buffer?: { from(data: Uint8Array): { toString(encoding: string): string } } }
  ).Buffer;
  if (nodeBuffer) return nodeBuffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0, len = bytes.byteLength; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(data: string): Uint8Array {
  const nodeBuffer = (
    globalThis as {
      Buffer?: { from(data: string, encoding: string): Uint8Array };
    }
  ).Buffer;
  if (nodeBuffer) return new Uint8Array(nodeBuffer.from(data, 'base64'));
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0, len = binary.length; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** A host without `crypto.subtle` (React Native) injects its own digest, as it already does for
 * `randomUUID`. */
export type Sha256Hex = (bytes: Uint8Array) => Promise<string>;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = (Reflect.get(globalThis, 'crypto') as { subtle?: SubtleCrypto } | undefined)
    ?.subtle;
  const digest = await nullthrow(
    subtle,
    'LinkCodeClient: no crypto.subtle — pass options.sha256Hex',
  ).digest('SHA-256', arrayBufferOf(bytes));
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0, len = view.byteLength; i < len; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
