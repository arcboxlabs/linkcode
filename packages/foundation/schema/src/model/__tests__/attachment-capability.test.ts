import { describe, expect, it } from 'vitest';
import type { AgentCapabilities } from '../agent/input';
import {
  AGENT_INPUT_CAPABILITIES,
  AgentCapabilitiesSchema,
  effectiveAttachmentCapability,
} from '../agent/input';
import {
  AttachmentCapabilitySchema,
  HOST_ATTACHMENT_LIMITS,
  intersectAttachmentCapability,
} from '../attachment';
import { MAX_ATTACHMENT_BYTES, SUPPORTED_ATTACHMENT_IMAGE_MIME_TYPES } from '../content';

const imageCapability = {
  kinds: {
    image: {
      mimeTypes: [...SUPPORTED_ATTACHMENT_IMAGE_MIME_TYPES],
      maxBytes: MAX_ATTACHMENT_BYTES,
      maxCount: 16,
    },
  },
  representations: ['inline_image'] as const,
};

describe('AttachmentCapability', () => {
  it('parses a declared image capability and rejects an empty representation list', () => {
    expect(AttachmentCapabilitySchema.safeParse(imageCapability).success).toBe(true);
    expect(
      AttachmentCapabilitySchema.safeParse({
        kinds: imageCapability.kinds,
        representations: [],
      }).success,
    ).toBe(false);
  });
});

describe('AgentCapabilities.attachments', () => {
  it('is optional so mixed-version peers still parse', () => {
    expect(
      AgentCapabilitiesSchema.safeParse({ slashCommands: true, shellCommand: false }).success,
    ).toBe(true);
    expect(
      AgentCapabilitiesSchema.safeParse({
        slashCommands: true,
        shellCommand: false,
        attachments: imageCapability,
      }).success,
    ).toBe(true);
  });
});

describe('AttachmentCapability forward compatibility', () => {
  it('parses a representation this build does not know so the frame still validates', () => {
    const parsed = AttachmentCapabilitySchema.safeParse({
      kinds: imageCapability.kinds,
      representations: ['inline_image', 'extracted_text'],
    });
    expect(parsed.success).toBe(true);
  });

  it('drops the unknown representation at the host intersection', () => {
    const effective = intersectAttachmentCapability({
      kinds: imageCapability.kinds,
      representations: ['inline_image', 'extracted_text'],
    });
    expect(effective?.representations).toEqual(['inline_image']);
  });

  it('treats a capability of only unknown representations as no support', () => {
    expect(
      intersectAttachmentCapability({
        kinds: imageCapability.kinds,
        representations: ['extracted_text'],
      }),
    ).toBeUndefined();
  });
});

describe('intersectAttachmentCapability', () => {
  it('returns undefined when the adapter declared nothing', () => {
    expect(intersectAttachmentCapability(undefined)).toBeUndefined();
  });

  it('intersects mime types, byte caps, counts, and representations with the host', () => {
    const effective = intersectAttachmentCapability({
      kinds: {
        image: {
          mimeTypes: ['image/png', 'image/svg+xml'],
          maxBytes: MAX_ATTACHMENT_BYTES * 2,
          maxCount: 4,
        },
      },
      representations: ['inline_image', 'readonly_file'],
    });
    expect(effective).toEqual({
      kinds: {
        image: {
          mimeTypes: ['image/png'],
          maxBytes: MAX_ATTACHMENT_BYTES,
          maxCount: 4,
        },
      },
      representations: ['inline_image', 'readonly_file'],
    });
  });

  it('drops a kind whose mime types miss the host allowlist', () => {
    expect(
      intersectAttachmentCapability({
        kinds: {
          image: { mimeTypes: ['image/svg+xml'], maxBytes: 1024, maxCount: 1 },
        },
        representations: ['inline_image'],
      }),
    ).toBeUndefined();
  });

  it('keeps grok-build dark and the other harnesses on inline images', () => {
    expect(effectiveAttachmentCapability('grok-build')).toBeUndefined();
    const grok: AgentCapabilities = AGENT_INPUT_CAPABILITIES['grok-build'];
    expect(grok.attachments).toBeUndefined();
    const imageKinds = ['claude-code', 'codex', 'opencode', 'pi'] as const;
    for (let i = 0, len = imageKinds.length; i < len; i++) {
      const effective = effectiveAttachmentCapability(imageKinds[i]);
      expect(effective?.representations).toEqual(['inline_image']);
      expect(effective?.kinds.image?.mimeTypes).toEqual([...SUPPORTED_ATTACHMENT_IMAGE_MIME_TYPES]);
      expect(effective?.kinds.file).toBeUndefined();
    }
  });

  it('does not advertise file when the host has no file kind', () => {
    expect(HOST_ATTACHMENT_LIMITS.kinds.file).toBeUndefined();
    const effective = intersectAttachmentCapability({
      kinds: {
        image: {
          mimeTypes: ['image/png'],
          maxBytes: MAX_ATTACHMENT_BYTES,
          maxCount: 1,
        },
        file: { mimeTypes: ['application/pdf'], maxBytes: MAX_ATTACHMENT_BYTES, maxCount: 1 },
      },
      representations: ['inline_image', 'readonly_file'],
    });
    expect(effective?.kinds.file).toBeUndefined();
    expect(effective?.kinds.image).toEqual({
      mimeTypes: ['image/png'],
      maxBytes: MAX_ATTACHMENT_BYTES,
      maxCount: 1,
    });
  });
});
