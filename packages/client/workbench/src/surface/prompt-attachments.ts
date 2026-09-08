import type { Conversation, LinkCodeClient } from '@linkcode/client-core';
import { base64ToBytes } from '@linkcode/client-core';
import type {
  AttachmentId,
  ContentBlock,
  MessageId,
  PromptBlock,
  SessionId,
} from '@linkcode/schema';
import {
  AttachmentIdSchema,
  attachmentIdFromUri,
  attachmentUri,
  declaredMimeTypeMatches,
  MAX_ATTACHMENT_NAME_LENGTH,
} from '@linkcode/schema';
import type { ComposerAttachment } from '@linkcode/ui';
import { isErrorLikeObject } from 'foxts/extract-error-message';

const objectUrls = new Map<string, string>();
/** Bumped by each revoke: a preview read that started before it must not mint a URL after it. */
let urlGeneration = 0;

function blobUrlFor(bytes: Uint8Array, mimeType?: string): string {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy], { type: mimeType || undefined }));
}

/** Timeline preview URLs. Revoked on session switch. Composer tray URLs are owned by the tray. */
export function attachmentObjectUrl(
  attachmentId: string,
  bytes: Uint8Array,
  mimeType?: string,
): string {
  const existing = objectUrls.get(attachmentId);
  if (existing) return existing;
  const url = blobUrlFor(bytes, mimeType);
  objectUrls.set(attachmentId, url);
  return url;
}

export function revokeAttachmentObjectUrls(): void {
  urlGeneration += 1;
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

/** The timeline preview of a stored attachment; `null` is a durable miss. A read that outlives the
 * session switch mints no URL: the preview store discards the result, and the revoke already ran. */
export async function resolveStoredAttachmentPreview(
  client: Pick<LinkCodeClient, 'getAttachmentBytes'>,
  sessionId: SessionId,
  attachmentId: string,
): Promise<{ url: string } | null> {
  const generation = urlGeneration;
  try {
    const { bytes } = await client.getAttachmentBytes(
      sessionId,
      AttachmentIdSchema.parse(attachmentId),
    );
    if (generation !== urlGeneration) return null;
    return { url: attachmentObjectUrl(attachmentId, bytes) };
  } catch (error) {
    if (isErrorLikeObject(error) && 'code' in error && error.code === 'not_found') return null;
    throw error;
  }
}

export function isStoredAttachmentBlock(block: ContentBlock): boolean {
  return block.type === 'resource_link' && attachmentIdFromUri(block.uri) !== undefined;
}

/** `undefined` when a block has no `turn.submit` form (inline image, resource): the caller must
 * send that content on the legacy path rather than silently drop the block. */
export function promptBlocksFromComposer(
  content: readonly ContentBlock[],
): PromptBlock[] | undefined {
  const blocks: PromptBlock[] = [];
  for (let i = 0, len = content.length; i < len; i++) {
    const block = content[i];
    if (block.type === 'text') {
      blocks.push({ type: 'text', text: block.text });
      continue;
    }
    const id = block.type === 'resource_link' ? attachmentIdFromUri(block.uri) : undefined;
    if (id === undefined) return;
    blocks.push({ type: 'attachment_ref', attachmentId: AttachmentIdSchema.parse(id) });
  }
  return blocks;
}

export function storedAttachmentBlocks(content: readonly ContentBlock[]): ContentBlock[] {
  return content.filter(isStoredAttachmentBlock);
}

function storedAttachmentResourceLink(
  attachmentId: AttachmentId,
  name: string,
  mimeType: string | undefined,
  sizeBytes: number,
  kind: string,
): ContentBlock {
  return {
    type: 'resource_link',
    uri: attachmentUri(attachmentId),
    name,
    ...(mimeType !== undefined && mimeType.length > 0 && { mimeType }),
    size: sizeBytes,
    description: kind,
  };
}

export async function stageStoreAttachment(
  client: Pick<LinkCodeClient, 'putAttachment'>,
  file: File,
  pending: ComposerAttachment,
  errors: { contentMismatch: string },
): Promise<ComposerAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The daemon sniffs at commit; refusing here saves the transfer of a mislabeled file.
  if (!declaredMimeTypeMatches(file.type, bytes.subarray(0, 16))) {
    throw new Error(errors.contentMismatch);
  }
  const kind = pending.kind === 'image' ? 'image' : 'file';
  // Records cap the name; the daemon caps a legacy upload's the same way rather than refusing it.
  const name = file.name.slice(0, MAX_ATTACHMENT_NAME_LENGTH);
  const { attachmentId } = await client.putAttachment({
    bytes,
    name,
    mimeType: file.type || undefined,
    attachmentKind: kind,
  });
  return {
    ...pending,
    status: 'ready',
    url: blobUrlFor(bytes, file.type),
    block: storedAttachmentResourceLink(attachmentId, name, file.type, file.size, kind),
  };
}

export async function stageStoreAttachmentFromBase64(
  client: Pick<LinkCodeClient, 'putAttachment'>,
  pending: ComposerAttachment,
  content: string,
  mimeType: string | undefined,
  size: number,
): Promise<ComposerAttachment> {
  const bytes = base64ToBytes(content);
  const kind = pending.kind === 'image' ? 'image' : 'file';
  const { attachmentId } = await client.putAttachment({
    bytes,
    name: pending.name,
    mimeType,
    attachmentKind: kind,
  });
  return {
    ...pending,
    status: 'ready',
    mimeType,
    sizeBytes: size,
    url: blobUrlFor(bytes, mimeType),
    block: storedAttachmentResourceLink(attachmentId, pending.name, mimeType, size, kind),
  };
}

interface PendingUserRow {
  readonly messageId: string;
  readonly blocks: readonly ContentBlock[];
}

interface InflightUserAttachments {
  readonly blocks: readonly ContentBlock[];
  readonly startedAt: number;
  /** The echo is text-only; matching its text keeps the refs off another author's row. */
  readonly text: string;
}

function promptTextOf(blocks: readonly ContentBlock[]): string {
  let text = '';
  for (let i = 0, len = blocks.length; i < len; i++) {
    const block = blocks[i];
    if (block.type === 'text') text += block.text;
  }
  return text;
}

/** Replaced wholesale on every change: the render reads this snapshot, never the module maps. */
export interface PendingUserAttachments {
  readonly pending: ReadonlyMap<SessionId, PendingUserRow>;
  readonly inflight: ReadonlyMap<SessionId, InflightUserAttachments>;
}

let snapshot: PendingUserAttachments = { pending: new Map(), inflight: new Map() };
const pendingListeners = new Set<() => void>();

function updatePending(
  mutate: (
    pending: Map<SessionId, PendingUserRow>,
    inflight: Map<SessionId, InflightUserAttachments>,
  ) => void,
): void {
  const pending = new Map(snapshot.pending);
  const inflight = new Map(snapshot.inflight);
  mutate(pending, inflight);
  snapshot = { pending, inflight };
  for (const listener of pendingListeners) listener();
}

/** Only a session's newest prompt can still be echoing text-only, so one entry per session. */
export function notePendingUserAttachments(
  sessionId: SessionId,
  messageId: MessageId,
  blocks: readonly ContentBlock[],
): void {
  const refs = storedAttachmentBlocks(blocks);
  if (refs.length === 0) return;
  updatePending((pending) => {
    pending.set(sessionId, { messageId, blocks: refs });
  });
}

/** Stash refs before `await submitTurn` — the echo arrives during send, `turn.submitted` after. */
export function noteInflightUserAttachments(
  sessionId: SessionId,
  blocks: readonly ContentBlock[],
): void {
  const refs = storedAttachmentBlocks(blocks);
  if (refs.length === 0) return;
  updatePending((_pending, inflight) => {
    inflight.set(sessionId, { blocks: refs, startedAt: Date.now(), text: promptTextOf(blocks) });
  });
}

export function clearInflightUserAttachments(sessionId: SessionId): void {
  if (!snapshot.inflight.has(sessionId)) return;
  updatePending((_pending, inflight) => {
    inflight.delete(sessionId);
  });
}

export function subscribePendingUserAttachments(onStoreChange: () => void): () => void {
  pendingListeners.add(onStoreChange);
  return () => {
    pendingListeners.delete(onStoreChange);
  };
}

export function pendingUserAttachmentsSnapshot(): PendingUserAttachments {
  return snapshot;
}

export function overlayPendingUserAttachments(
  conversation: Conversation,
  sessionId: SessionId | null,
  { inflight, pending }: PendingUserAttachments,
): Conversation {
  if (!sessionId) return conversation;
  const row = pending.get(sessionId);
  const live = inflight.get(sessionId);
  if (row === undefined && live === undefined) return conversation;
  let changed = false;
  const next = conversation.items.slice();
  if (row !== undefined) {
    for (let i = next.length - 1; i >= 0; i--) {
      const item = next[i];
      if (item.kind !== 'message' || item.role !== 'user' || item.id !== row.messageId) continue;
      if (!item.blocks.some(isStoredAttachmentBlock)) {
        next[i] = { ...item, blocks: [...item.blocks, ...row.blocks] };
        changed = true;
      }
      break;
    }
  }
  if (live !== undefined) {
    for (let i = next.length - 1; i >= 0; i--) {
      const item = next[i];
      if (item.kind !== 'message' || item.role !== 'user') continue;
      if (item.receivedAt === undefined || item.receivedAt < live.startedAt) continue;
      if (promptTextOf(item.blocks) !== live.text) continue;
      if (!item.blocks.some(isStoredAttachmentBlock)) {
        next[i] = { ...item, blocks: [...item.blocks, ...live.blocks] };
        changed = true;
      }
      break;
    }
  }
  if (!changed) return conversation;
  return { ...conversation, items: next };
}
