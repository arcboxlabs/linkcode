import type {
  AttachmentCapability,
  AttachmentId,
  ContentBlock,
  PromptBlock,
} from '@linkcode/schema';
import { MAX_ATTACHMENT_TOTAL_BYTES } from '@linkcode/schema';
import { RequestError } from '../failure';
import type { StoredAttachment } from './attachment-store';

export function attachmentIdsFromBlocks(blocks: readonly PromptBlock[]): AttachmentId[] {
  const ids: AttachmentId[] = [];
  for (let i = 0, len = blocks.length; i < len; i++) {
    const block = blocks[i];
    if (block.type === 'attachment_ref') ids.push(block.attachmentId);
  }
  return ids;
}

/** Unique ids in first-seen order. */
export function uniqueAttachmentIds(ids: readonly AttachmentId[]): AttachmentId[] {
  const seen = new Set<AttachmentId>();
  const unique: AttachmentId[] = [];
  for (let i = 0, len = ids.length; i < len; i++) {
    const id = ids[i];
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function kindLimits(capability: AttachmentCapability, kind: string) {
  if (kind === 'image') return capability.kinds.image;
  return capability.kinds.file;
}

function representationFor(
  capability: AttachmentCapability,
  kind: string,
): 'inline_image' | 'readonly_file' | undefined {
  const representations = capability.representations;
  if (kind === 'image' && representations.includes('inline_image')) return 'inline_image';
  if (representations.includes('readonly_file')) return 'readonly_file';
  return undefined;
}

/**
 * Admit a prompt's `attachment_ref`s against the effective capability. Throws `RequestError`
 * (`unsupported_attachment` for missing/unknown/undeclared, `limit_exceeded` for size/count).
 */
export function admitPromptAttachments(
  blocks: readonly PromptBlock[],
  stored: readonly StoredAttachment[],
  capability: AttachmentCapability | undefined,
): void {
  const ids = uniqueAttachmentIds(attachmentIdsFromBlocks(blocks));
  if (ids.length === 0) return;
  if (!capability) {
    throw new RequestError({
      code: 'unsupported_attachment',
      message: 'Prompt attachments are not supported by this harness',
    });
  }
  const byId = new Map<AttachmentId, StoredAttachment>();
  for (let i = 0, len = stored.length; i < len; i++) {
    byId.set(stored[i].attachmentId, stored[i]);
  }
  let totalBytes = 0;
  let imageCount = 0;
  let fileCount = 0;
  for (let i = 0, len = ids.length; i < len; i++) {
    const id = ids[i];
    const attachment = byId.get(id);
    if (!attachment) {
      throw new RequestError({
        code: 'unsupported_attachment',
        message: 'Unknown attachment',
      });
    }
    if (!representationFor(capability, attachment.kind)) {
      throw new RequestError({
        code: 'unsupported_attachment',
        message: `This harness does not accept ${attachment.kind} attachments`,
      });
    }
    const limits = kindLimits(capability, attachment.kind);
    if (!limits) {
      throw new RequestError({
        code: 'unsupported_attachment',
        message: `This harness does not accept ${attachment.kind} attachments`,
      });
    }
    if (!limits.mimeTypes.includes(attachment.mimeType)) {
      throw new RequestError({
        code: 'unsupported_attachment',
        message: `Unsupported attachment type: ${attachment.mimeType}`,
      });
    }
    if (attachment.sizeBytes > limits.maxBytes) {
      throw new RequestError({
        code: 'limit_exceeded',
        message: 'Attachment exceeds the maximum allowed size',
      });
    }
    if (attachment.kind === 'image') imageCount += 1;
    else fileCount += 1;
    const maxCount = limits.maxCount;
    if (
      (attachment.kind === 'image' && imageCount > maxCount) ||
      (attachment.kind === 'file' && fileCount > maxCount)
    ) {
      throw new RequestError({
        code: 'limit_exceeded',
        message: 'Too many attachments',
      });
    }
    totalBytes += attachment.sizeBytes;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new RequestError({
        code: 'limit_exceeded',
        message: 'Attachments exceed the maximum allowed total size',
      });
    }
  }
}

/** Legacy `agent.input` images: size/mime already passed the inline guard; this is the capability gate. */
export function assertInlineAttachmentsSupported(
  content: ContentBlock[],
  capability: AttachmentCapability | undefined,
): void {
  for (let i = 0, len = content.length; i < len; i++) {
    const block = content[i];
    if (
      block.type !== 'image' &&
      block.type !== 'audio' &&
      block.type !== 'resource' &&
      block.type !== 'resource_link'
    ) {
      continue;
    }
    if (!capability) {
      throw new RequestError({
        code: 'unsupported_attachment',
        message: 'Prompt attachments are not supported by this harness',
      });
    }
    if (block.type === 'image') {
      const limits = capability.kinds.image;
      if (limits === undefined || !capability.representations.includes('inline_image')) {
        throw new RequestError({
          code: 'unsupported_attachment',
          message: 'This harness does not accept image attachments',
        });
      }
      if (!limits.mimeTypes.includes(block.mimeType)) {
        throw new RequestError({
          code: 'unsupported_attachment',
          message: `Unsupported attachment type: ${block.mimeType}`,
        });
      }
      continue;
    }
    if (!capability.representations.includes('readonly_file')) {
      throw new RequestError({
        code: 'unsupported_attachment',
        message: 'This harness does not accept file attachments',
      });
    }
  }
}
