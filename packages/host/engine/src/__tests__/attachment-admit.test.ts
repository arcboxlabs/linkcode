import {
  AttachmentIdSchema,
  blobIdFromSha256,
  effectiveAttachmentCapability,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
} from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { admitPromptAttachments, assertInlineAttachmentsSupported } from '../attachment/admit';
import type { StoredAttachment } from '../attachment/attachment-store';
import { RequestError } from '../failure';

const ATT_1 = AttachmentIdSchema.parse('att-1');
const ATT_2 = AttachmentIdSchema.parse('att-2');

function stored(
  partial: Partial<StoredAttachment> & { attachmentId?: StoredAttachment['attachmentId'] },
): StoredAttachment {
  return {
    attachmentId: partial.attachmentId ?? ATT_1,
    kind: partial.kind ?? 'image',
    name: partial.name ?? 'shot.png',
    mimeType: partial.mimeType ?? 'image/png',
    sizeBytes: partial.sizeBytes ?? 16,
    metadata: {},
    createdAt: 1,
    blobId: partial.blobId ?? blobIdFromSha256('a'.repeat(64)),
  };
}

describe('admitPromptAttachments', () => {
  const capability = effectiveAttachmentCapability('claude-code');

  it('accepts a ready image within the effective capability', () => {
    expect(() =>
      admitPromptAttachments(
        [{ type: 'attachment_ref', attachmentId: ATT_1 }],
        [stored({})],
        capability,
      ),
    ).not.toThrow();
  });

  it('refuses refs when the harness declared nothing', () => {
    expect(() =>
      admitPromptAttachments(
        [{ type: 'attachment_ref', attachmentId: ATT_1 }],
        [stored({})],
        undefined,
      ),
    ).toThrow(RequestError);
    try {
      admitPromptAttachments(
        [{ type: 'attachment_ref', attachmentId: ATT_1 }],
        [stored({})],
        undefined,
      );
    } catch (error) {
      expect(error).toMatchObject({ code: 'unsupported_attachment' });
    }
  });

  it('refuses a missing attachment before persist', () => {
    try {
      admitPromptAttachments([{ type: 'attachment_ref', attachmentId: ATT_1 }], [], capability);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'unsupported_attachment',
        message: 'Unknown attachment',
      });
      return;
    }
    expect.fail('expected a typed refusal');
  });

  it('refuses an undeclared mime type', () => {
    try {
      admitPromptAttachments(
        [{ type: 'attachment_ref', attachmentId: ATT_1 }],
        [stored({ mimeType: 'image/svg+xml' })],
        capability,
      );
    } catch (error) {
      expect(error).toMatchObject({ code: 'unsupported_attachment' });
      return;
    }
    expect.fail('expected a typed refusal');
  });

  it('refuses a file that exceeds the per-attachment cap', () => {
    try {
      admitPromptAttachments(
        [{ type: 'attachment_ref', attachmentId: ATT_1 }],
        [stored({ sizeBytes: MAX_ATTACHMENT_BYTES + 1 })],
        capability,
      );
    } catch (error) {
      expect(error).toMatchObject({ code: 'limit_exceeded' });
      return;
    }
    expect.fail('expected a typed refusal');
  });

  it('refuses a prompt whose unique attachments exceed the aggregate cap', () => {
    try {
      admitPromptAttachments(
        [
          { type: 'attachment_ref', attachmentId: ATT_1 },
          { type: 'attachment_ref', attachmentId: ATT_2 },
        ],
        [
          stored({ attachmentId: ATT_1, sizeBytes: MAX_ATTACHMENT_TOTAL_BYTES / 2 }),
          stored({ attachmentId: ATT_2, sizeBytes: MAX_ATTACHMENT_TOTAL_BYTES / 2 + 1 }),
        ],
        capability,
      );
    } catch (error) {
      expect(error).toMatchObject({ code: 'limit_exceeded' });
      return;
    }
    expect.fail('expected a typed refusal');
  });
});

describe('assertInlineAttachmentsSupported', () => {
  it('lets a claude-code image through and refuses grok-build', () => {
    const image = { type: 'image' as const, mimeType: 'image/png', data: 'AA==' };
    expect(() =>
      assertInlineAttachmentsSupported([image], effectiveAttachmentCapability('claude-code')),
    ).not.toThrow();
    try {
      assertInlineAttachmentsSupported([image], effectiveAttachmentCapability('grok-build'));
    } catch (error) {
      expect(error).toMatchObject({ code: 'unsupported_attachment' });
      return;
    }
    expect.fail('expected a typed refusal');
  });
});
