import type { ContentBlock } from '@linkcode/schema';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { assertAttachmentContentAllowed } from '../attachment-guard';

function imageOfBytes(bytes: number, mimeType = 'image/png'): ContentBlock {
  return { type: 'image', data: Buffer.alloc(bytes).toString('base64'), mimeType };
}

describe('assertAttachmentContentAllowed', () => {
  it('ignores text-only content', () => {
    expect(() => assertAttachmentContentAllowed([{ type: 'text', text: 'hi' }])).not.toThrow();
  });

  it('accepts a block at exactly the per-attachment cap', () => {
    // The client checks the pre-encode file size; the boundary file must pass here too.
    expect(() =>
      assertAttachmentContentAllowed([imageOfBytes(MAX_ATTACHMENT_BYTES)]),
    ).not.toThrow();
  });

  it('rejects a block one byte over the per-attachment cap', () => {
    expect(() => assertAttachmentContentAllowed([imageOfBytes(MAX_ATTACHMENT_BYTES + 1)])).toThrow(
      /maximum allowed size/,
    );
  });

  it('rejects an unsupported image mime type', () => {
    expect(() => assertAttachmentContentAllowed([imageOfBytes(16, 'image/svg+xml')])).toThrow(
      /Unsupported image attachment type/,
    );
  });

  it('accepts individually-valid blocks up to the aggregate cap', () => {
    const half = MAX_ATTACHMENT_TOTAL_BYTES / 2;
    expect(() =>
      assertAttachmentContentAllowed([imageOfBytes(half), imageOfBytes(half)]),
    ).not.toThrow();
  });

  it('rejects individually-valid blocks whose sum exceeds the aggregate cap', () => {
    const half = MAX_ATTACHMENT_TOTAL_BYTES / 2;
    expect(() =>
      assertAttachmentContentAllowed([imageOfBytes(half), imageOfBytes(half + 3)]),
    ).toThrow(/maximum allowed total size/);
  });

  it('counts audio and embedded-resource blobs toward the caps', () => {
    const audio: ContentBlock = {
      type: 'audio',
      data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64'),
      mimeType: 'audio/mpeg',
    };
    expect(() => assertAttachmentContentAllowed([audio])).toThrow(/maximum allowed size/);

    const resource: ContentBlock = {
      type: 'resource',
      resource: {
        uri: 'file:///blob.bin',
        blob: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64'),
      },
    };
    expect(() => assertAttachmentContentAllowed([resource])).toThrow(/maximum allowed size/);
  });
});
