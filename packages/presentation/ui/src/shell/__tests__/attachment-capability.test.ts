import { AGENT_INPUT_CAPABILITIES } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  composerAttachmentCapability,
  composerAttachmentsSupported,
} from '../attachment-capability';

describe('composerAttachmentCapability', () => {
  it('intersects the pre-session matrix when no live capabilities have arrived', () => {
    expect(composerAttachmentsSupported('codex')).toBe(true);
    expect(composerAttachmentsSupported('grok-build')).toBe(false);
    expect(composerAttachmentCapability('codex')?.kinds.image).toBeDefined();
  });

  it('keeps the matrix when a live update omits attachments (old daemon)', () => {
    expect(
      composerAttachmentsSupported('codex', {
        slashCommands: true,
        shellCommand: true,
      }),
    ).toBe(true);
    expect(
      composerAttachmentsSupported('grok-build', {
        slashCommands: false,
        shellCommand: false,
      }),
    ).toBe(false);
  });

  it('intersects a live attachments declaration instead of the matrix', () => {
    expect(
      composerAttachmentsSupported('grok-build', {
        slashCommands: false,
        shellCommand: false,
        attachments: AGENT_INPUT_CAPABILITIES.codex.attachments,
      }),
    ).toBe(true);
  });

  it('stays off when no harness is picked', () => {
    expect(composerAttachmentsSupported(undefined)).toBe(false);
  });
});
