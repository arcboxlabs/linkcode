import type { ContentBlock } from '@linkcode/schema';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES } from '@linkcode/schema';
import { createFixedArray } from 'foxts/create-fixed-array';
import { describe, expect, it } from 'vitest';
import { assertAttachmentContentAllowed } from '../session/attachment-guard';

const OVER_PER_ATTACHMENT_CAP_RE = /maximum allowed size/;
const OVER_AGGREGATE_CAP_RE = /maximum allowed total size/;
const UNSUPPORTED_IMAGE_TYPE_RE = /Unsupported image attachment type/;

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
      OVER_PER_ATTACHMENT_CAP_RE,
    );
  });

  it('rejects an unsupported image mime type', () => {
    expect(() => assertAttachmentContentAllowed([imageOfBytes(16, 'image/svg+xml')])).toThrow(
      UNSUPPORTED_IMAGE_TYPE_RE,
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
    ).toThrow(OVER_AGGREGATE_CAP_RE);
  });

  it('counts audio and embedded-resource blobs toward the caps', () => {
    const audio: ContentBlock = {
      type: 'audio',
      data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64'),
      mimeType: 'audio/mpeg',
    };
    expect(() => assertAttachmentContentAllowed([audio])).toThrow(OVER_PER_ATTACHMENT_CAP_RE);

    const resource: ContentBlock = {
      type: 'resource',
      resource: {
        uri: 'file:///blob.bin',
        blob: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64'),
      },
    };
    expect(() => assertAttachmentContentAllowed([resource])).toThrow(OVER_PER_ATTACHMENT_CAP_RE);
  });

  it('never lets malformed base64 erode the aggregate accounting', () => {
    // A bare "=" would naively decode to -1 bytes; interleaving such blocks must not offset the
    // running total below what the legitimate blocks actually occupy.
    const garbage: ContentBlock[] = createFixedArray(8).map(() => ({
      type: 'resource' as const,
      resource: { uri: 'file:///x', blob: '=' },
    }));
    const half = MAX_ATTACHMENT_TOTAL_BYTES / 2;
    expect(() =>
      assertAttachmentContentAllowed([...garbage, imageOfBytes(half), imageOfBytes(half + 3)]),
    ).toThrow(OVER_AGGREGATE_CAP_RE);
  });
});
