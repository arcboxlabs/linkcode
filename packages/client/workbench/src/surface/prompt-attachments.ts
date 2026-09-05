import type { Conversation, LinkCodeClient } from '@linkcode/client-core';
import { base64ToBytes } from '@linkcode/client-core';
import type {
  AttachmentId,
  ContentBlock,
  MessageId,
  PromptBlock,
  SessionId,
} from '@linkcode/schema';
import { AttachmentIdSchema, attachmentIdFromUri, attachmentUri } from '@linkcode/schema';
import type { ComposerAttachment } from '@linkcode/ui';

const objectUrls = new Map<string, string>();

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
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
}

export function isStoredAttachmentBlock(block: ContentBlock): boolean {
  return block.type === 'resource_link' && attachmentIdFromUri(block.uri) !== undefined;
}

export function promptBlocksFromComposer(content: readonly ContentBlock[]): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  for (let i = 0, len = content.length; i < len; i++) {
    const block = content[i];
    if (block.type === 'text') {
      blocks.push({ type: 'text', text: block.text });
      continue;
    }
    if (block.type !== 'resource_link') continue;
    const id = attachmentIdFromUri(block.uri);
    if (id === undefined) continue;
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
  client: LinkCodeClient,
  file: File,
  pending: ComposerAttachment,
): Promise<ComposerAttachment> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = pending.kind === 'image' ? 'image' : 'file';
  const { attachmentId } = await client.putAttachment({
    bytes,
    name: file.name,
    mimeType: file.type || undefined,
    attachmentKind: kind,
  });
  return {
    ...pending,
    status: 'ready',
    url: blobUrlFor(bytes, file.type),
    block: storedAttachmentResourceLink(attachmentId, file.name, file.type, file.size, kind),
  };
}

export async function stageStoreAttachmentFromBase64(
  client: LinkCodeClient,
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

type PendingKey = `${string}:${string}`;

const pendingByRow = new Map<PendingKey, ContentBlock[]>();
const inflightBySession = new Map<SessionId, { blocks: ContentBlock[]; startedAt: number }>();
let pendingVersion = 0;
const pendingListeners = new Set<() => void>();

function pendingKey(sessionId: SessionId, messageId: string): PendingKey {
  return `${sessionId}:${messageId}`;
}

function bumpPending(): void {
  pendingVersion += 1;
  for (const listener of pendingListeners) listener();
}

export function notePendingUserAttachments(
  sessionId: SessionId,
  messageId: MessageId,
  blocks: readonly ContentBlock[],
): void {
  const refs = storedAttachmentBlocks(blocks);
  if (refs.length === 0) return;
  pendingByRow.set(pendingKey(sessionId, messageId), refs);
  bumpPending();
}

/** Stash refs before `await submitTurn` — the echo arrives during send, `turn.submitted` after. */
export function noteInflightUserAttachments(
  sessionId: SessionId,
  blocks: readonly ContentBlock[],
): void {
  const refs = storedAttachmentBlocks(blocks);
  if (refs.length === 0) return;
  inflightBySession.set(sessionId, { blocks: refs, startedAt: Date.now() });
  bumpPending();
}

export function clearInflightUserAttachments(sessionId: SessionId): void {
  if (!inflightBySession.delete(sessionId)) return;
  bumpPending();
}

export function subscribePendingUserAttachments(onStoreChange: () => void): () => void {
  pendingListeners.add(onStoreChange);
  return () => {
    pendingListeners.delete(onStoreChange);
  };
}

export function pendingUserAttachmentsVersion(): number {
  return pendingVersion;
}

export function overlayPendingUserAttachments(
  conversation: Conversation,
  sessionId: SessionId | null,
): Conversation {
  if (!sessionId) return conversation;
  const items = conversation.items;
  let changed = false;
  const next = items.slice();
  for (let i = 0, len = items.length; i < len; i++) {
    const item = items[i];
    if (item.kind !== 'message' || item.role !== 'user') continue;
    const extra = pendingByRow.get(pendingKey(sessionId, item.id));
    if (extra === undefined) continue;
    if (item.blocks.some(isStoredAttachmentBlock)) {
      pendingByRow.delete(pendingKey(sessionId, item.id));
      continue;
    }
    changed = true;
    next[i] = { ...item, blocks: [...item.blocks, ...extra] };
  }
  const inflight = inflightBySession.get(sessionId);
  if (inflight !== undefined) {
    for (let i = next.length - 1; i >= 0; i--) {
      const item = next[i];
      if (item.kind !== 'message' || item.role !== 'user') continue;
      if (item.receivedAt === undefined || item.receivedAt < inflight.startedAt) continue;
      if (!item.blocks.some(isStoredAttachmentBlock)) {
        next[i] = { ...item, blocks: [...item.blocks, ...inflight.blocks] };
        changed = true;
      }
      break;
    }
  }
  if (!changed) return conversation;
  return { ...conversation, items: next };
}
