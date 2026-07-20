import type { ContentBlock } from '@linkcode/schema';
import {
  isSupportedAttachmentImageMimeType,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
} from '@linkcode/schema';
import { RequestError } from '../failure';

/** Raw byte count of a base64 payload, kept exactly aligned with clients' pre-encode `File.size`
 * checks; clamped at zero so malformed non-base64 input can't erode the aggregate accounting. */
function base64RawByteLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length / 4) * 3) - padding);
}

function attachmentData(block: ContentBlock): string | undefined {
  if (block.type === 'image' || block.type === 'audio') return block.data;
  if (block.type === 'resource' && 'blob' in block.resource) return block.resource.blob;
  return undefined;
}

/** Defense-in-depth for less-trusted peers (mobile/Server tunnel); local clients already enforce
 * this before encoding. A throw surfaces as `request.failed` via the wire responder. The aggregate cap
 * keeps a prompt's base64 under the transport's frame buffer, whose overflow kills the connection. */
export function assertAttachmentContentAllowed(content: ContentBlock[]): void {
  let totalBytes = 0;
  for (const block of content) {
    if (block.type === 'image' && !isSupportedAttachmentImageMimeType(block.mimeType)) {
      throw new RequestError({
        code: 'invalid_request',
        message: `Unsupported image attachment type: ${block.mimeType}`,
      });
    }
    const data = attachmentData(block);
    if (data === undefined) continue;
    const bytes = base64RawByteLength(data);
    if (bytes > MAX_ATTACHMENT_BYTES) {
      throw new RequestError({
        code: 'limit_exceeded',
        message: 'Attachment exceeds the maximum allowed size',
      });
    }
    totalBytes += bytes;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new RequestError({
        code: 'limit_exceeded',
        message: 'Attachments exceed the maximum allowed total size',
      });
    }
  }
}
