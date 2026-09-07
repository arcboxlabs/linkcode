import {
  AttachmentIdSchema,
  blobIdFromSha256,
  effectiveAttachmentCapability,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
} from '@linkcode/schema';
import { createFixedArray } from 'foxts/create-fixed-array';
import { nullthrow } from 'foxts/guard';
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

  it('charges a repeated ref its bytes again so the aggregate cap bounds materialization', () => {
    const oversized = Math.ceil(MAX_ATTACHMENT_TOTAL_BYTES / 3);
    const blocks = [
      { type: 'attachment_ref' as const, attachmentId: ATT_1 },
      { type: 'attachment_ref' as const, attachmentId: ATT_1 },
      { type: 'attachment_ref' as const, attachmentId: ATT_1 },
      { type: 'attachment_ref' as const, attachmentId: ATT_1 },
    ];
    try {
      admitPromptAttachments(blocks, [stored({ sizeBytes: oversized })], capability);
    } catch (error) {
      expect(error).toBeInstanceOf(RequestError);
      expect(error).toMatchObject({ code: 'limit_exceeded' });
      return;
    }
    expect.fail('expected the repeated ref to exhaust the prompt aggregate cap');
  });

  it('counts every occurrence against maxCount, not the unique id set', () => {
    const capped = nullthrow(capability?.kinds.image?.maxCount, 'image maxCount');
    const blocks = createFixedArray(capped + 1).map(() => ({
      type: 'attachment_ref' as const,
      attachmentId: ATT_1,
    }));
    try {
      admitPromptAttachments(blocks, [stored({ sizeBytes: 1 })], capability);
    } catch (error) {
      expect(error).toMatchObject({ code: 'limit_exceeded', message: 'Too many attachments' });
      return;
    }
    expect.fail('expected the repeated ref to exhaust maxCount');
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

  it('refuses a resource_link when the harness did not declare readonly_file', () => {
    try {
      assertInlineAttachmentsSupported(
        [{ type: 'resource_link', uri: 'attachment:att-1', name: 'shot.png' }],
        effectiveAttachmentCapability('claude-code'),
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: 'unsupported_attachment',
        message: 'Editing a prompt attachment is not supported yet',
      });
      return;
    }
    expect.fail('expected a typed refusal');
  });

  it('counts inline images against the harness maxCount, the way a ref submit is counted', () => {
    const capability = nullthrow(effectiveAttachmentCapability('claude-code'));
    const maxCount = nullthrow(capability.kinds.image).maxCount;
    const image = { type: 'image' as const, mimeType: 'image/png', data: 'AA==' };
    expect(() =>
      assertInlineAttachmentsSupported(
        createFixedArray(maxCount).map(() => image),
        capability,
      ),
    ).not.toThrow();
    try {
      assertInlineAttachmentsSupported(
        createFixedArray(maxCount + 1).map(() => image),
        capability,
      );
    } catch (error) {
      expect(error).toMatchObject({ code: 'limit_exceeded', message: 'Too many attachments' });
      return;
    }
    expect.fail('expected a typed refusal');
  });
});

describe('admitPromptAttachments with a file kind declared', () => {
  const capability = {
    kinds: {
      file: { mimeTypes: ['application/pdf'], maxBytes: MAX_ATTACHMENT_BYTES, maxCount: 1 },
    },
    representations: ['readonly_file'],
  };

  it('bounds an unknown kind by the file maxCount', () => {
    const document = stored({ kind: 'document', mimeType: 'application/pdf', sizeBytes: 1 });
    expect(() =>
      admitPromptAttachments(
        [{ type: 'attachment_ref', attachmentId: ATT_1 }],
        [document],
        capability,
      ),
    ).not.toThrow();
    expect(() =>
      admitPromptAttachments(
        [
          { type: 'attachment_ref', attachmentId: ATT_1 },
          { type: 'attachment_ref', attachmentId: ATT_1 },
        ],
        [document],
        capability,
      ),
    ).toThrow(RequestError);
  });
});
