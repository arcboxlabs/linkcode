/** Decoded attachment bytes keyed by content-addressed `blobId`. Blobs are immutable. */
export class AttachmentBlobCache {
  private readonly blobs = new Map<string, Uint8Array>();

  get(blobId: string): Uint8Array | undefined {
    return this.blobs.get(blobId);
  }

  set(blobId: string, bytes: Uint8Array): void {
    this.blobs.set(blobId, bytes);
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

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', arrayBufferOf(bytes));
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
