import type { ContentBlock } from '@linkcode/schema';
import {
  isSupportedAttachmentImageMimeType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
} from '@linkcode/schema';

/** Raw byte count of a base64 payload. Counting the padding back out keeps the daemon's boundary
 * exactly where the clients' pre-encode `File.size` checks sit — no off-by-one window at the cap
 * where a client-approved file gets rejected here. */
function base64RawByteLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length / 4) * 3) - padding;
}

function attachmentData(block: ContentBlock): string | undefined {
  if (block.type === 'image' || block.type === 'audio') return block.data;
  if (block.type === 'resource' && 'blob' in block.resource) return block.resource.blob;
  return undefined;
}

/** Defense-in-depth for less-trusted peers (mobile/Server tunnel) — local desktop/webview already
 * enforce all of this client-side before ever encoding a file. Runs under `tryReply`, so a throw
 * surfaces to the sender as a `request.failed` reply. The aggregate cap matters beyond memory: a
 * prompt's total base64 must stay under the transport's frame buffer, whose overflow kills the
 * whole connection rather than one request. */
export function assertAttachmentContentAllowed(content: ContentBlock[]): void {
  let totalBytes = 0;
  for (const block of content) {
    if (block.type === 'image' && !isSupportedAttachmentImageMimeType(block.mimeType)) {
      throw new Error(`Unsupported image attachment type: ${block.mimeType}`);
    }
    const data = attachmentData(block);
    if (data === undefined) continue;
    const bytes = base64RawByteLength(data);
    if (bytes > MAX_ATTACHMENT_BYTES) {
      throw new Error('Attachment exceeds the maximum allowed size');
    }
    totalBytes += bytes;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new Error('Attachments exceed the maximum allowed total size');
    }
  }
}
