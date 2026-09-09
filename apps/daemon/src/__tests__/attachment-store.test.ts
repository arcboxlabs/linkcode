import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AttachmentStore } from '@linkcode/engine';
import type { AttachmentRecord, BlobRecord, UploadLease } from '@linkcode/schema';
import {
  AttachmentIdSchema,
  AttachmentRecordSchema,
  blobIdFromSha256,
  ConversationOperationSchema,
  ConversationTurnSchema,
  PromptRecordSchema,
  SessionIdSchema,
  SessionRecordSchema,
  SessionResourceSchema,
  UploadIdSchema,
  UploadLeaseSchema,
} from '@linkcode/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { createAttachmentStore } from '../attachment-store';
import { createConversationStore } from '../conversation-store';
import type { DaemonDatabase } from '../db/database';
import { openDaemonDatabase } from '../db/database';
import { createResourceStore } from '../resource-store';
import { createSessionStore } from '../session-store';

const temporaryDirectories: string[] = [];
const openDatabases = new Set<DaemonDatabase>();

afterEach(async () => {
  for (const database of openDatabases) database.close();
  openDatabases.clear();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const GRACE = 60 * 60 * 1000;
const NOW = 1_000_000;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function blob(text: string, createdAt = NOW): BlobRecord {
  return { blobId: blobIdFromSha256(sha256(text)), sizeBytes: text.length, createdAt };
}

function attachment(id: string, createdAt = NOW): AttachmentRecord {
  return AttachmentRecordSchema.parse({
    attachmentId: id,
    kind: 'image',
    name: `${id}.png`,
    mimeType: 'image/png',
    sizeBytes: 3,
    metadata: { width: 2, height: 1 },
    createdAt,
  });
}

function lease(uploadId: string, text: string): UploadLease {
  return UploadLeaseSchema.parse({
    uploadId,
    declaredSha256: sha256(text),
    declaredSize: text.length,
    name: 'draft.png',
    mimeType: 'image/png',
    kind: 'image',
    expiresAt: NOW + 24 * 60 * 60 * 1000,
    createdAt: NOW,
  });
}

async function fixture(): Promise<{
  readonly database: DaemonDatabase;
  readonly path: string;
  readonly store: AttachmentStore;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'linkcode-attachment-store-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'daemon.db');
  const database = openDaemonDatabase(path);
  openDatabases.add(database);
  await createSessionStore(database.client).save(
    SessionRecordSchema.parse({
      sessionId: 's-1',
      kind: 'claude-code',
      cwd: '/repo',
      origin: { type: 'created' },
      createdAt: 1,
      updatedAt: 1,
      runs: [],
    }),
  );
  return { database, path, store: createAttachmentStore(database.client) };
}

describe('SQLite attachment store', () => {
  it('round-trips attachments, blobs, and leases through a fresh store instance', async () => {
    const { database, store } = await fixture();
    const begun = await store.beginUpload(lease('up-1', 'abc'));
    expect(begun.blobId).toBeUndefined();
    await store.commitAttachment({
      blob: blob('abc'),
      attachment: attachment('att-1'),
      uploadId: UploadIdSchema.parse('up-1'),
    });

    const reopened = createAttachmentStore(database.client);
    expect(await reopened.getAttachment(AttachmentIdSchema.parse('att-1'))).toEqual({
      ...attachment('att-1'),
      blobId: blob('abc').blobId,
    });
    expect(await reopened.getBlob(blob('abc').blobId)).toEqual(blob('abc'));
    expect(await reopened.getLease(UploadIdSchema.parse('up-1'))).toEqual({
      ...lease('up-1', 'abc'),
      blobId: blob('abc').blobId,
      attachmentId: 'att-1',
    });
    expect(await reopened.listAttachments([AttachmentIdSchema.parse('missing')])).toEqual([]);

    const pinned = await reopened.beginUpload(lease('up-2', 'abc'));
    expect(pinned.blobId).toBe(blob('abc').blobId);
    await expect(async () => reopened.beginUpload(lease('up-2', 'abc'))).rejects.toThrow('UNIQUE');
    await reopened.deleteLease(UploadIdSchema.parse('up-2'));
    expect(await reopened.getLease(UploadIdSchema.parse('up-2'))).toBeUndefined();
  });

  it('reaps only unrooted rows past the grace window and claims leases on prompt persist', async () => {
    const { database, path, store } = await fixture();
    const conversations = createConversationStore(database.client);
    const resources = createResourceStore(path);
    const shared = blob('shared');
    const leasedOnly = blob('leased');
    const viaResource = blob('resource');

    await store.beginUpload(lease('up-prompt', 'shared'));
    await store.commitAttachment({
      blob: shared,
      attachment: attachment('att-prompt'),
      uploadId: UploadIdSchema.parse('up-prompt'),
    });
    await store.commitAttachment({ blob: shared, attachment: attachment('att-stray') });
    await store.beginUpload(lease('up-leased', 'leased'));
    await store.commitAttachment({
      blob: leasedOnly,
      attachment: attachment('att-leased'),
      uploadId: UploadIdSchema.parse('up-leased'),
    });
    await store.commitAttachment({ blob: viaResource, attachment: attachment('att-resource') });

    await conversations.persistTurnIntent({
      turn: ConversationTurnSchema.parse({
        turnId: 't-1',
        sessionId: 's-1',
        parentTurnId: null,
        siblingOrdinal: 1,
        input: { type: 'prompt', promptId: 'p-1' },
        runId: 'run-1',
        state: 'preparing',
        createdAt: 1,
      }),
      prompt: PromptRecordSchema.parse({
        promptId: 'p-1',
        blocks: [{ type: 'attachment_ref', attachmentId: 'att-prompt' }],
        contextAttachmentIds: [],
        createdAt: 1,
      }),
      operation: ConversationOperationSchema.parse({
        operationId: 'op-1',
        sessionId: 's-1',
        kind: 'turn.submit',
        state: 'open',
        createdAt: 1,
      }),
    });
    // The prompt is the root now; the draft lease that pinned the attachment is released.
    expect(await store.getLease(UploadIdSchema.parse('up-prompt'))).toBeUndefined();
    await resources.save(
      SessionResourceSchema.parse({
        resourceId: 'resource-1',
        sessionId: 's-1',
        direction: 'source',
        name: 'brief.png',
        kind: 'image',
        status: 'ready',
        locator: { type: 'managed-file', path: '/state/blobs/x' },
        attachmentId: 'att-resource',
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    expect(await store.sweep({ now: NOW, graceBefore: NOW })).toEqual([]);
    expect(await store.getAttachment(AttachmentIdSchema.parse('att-stray'))).toBeDefined();

    expect(await store.sweep({ now: NOW + 1, graceBefore: NOW + GRACE })).toEqual([]);
    expect(await store.getAttachment(AttachmentIdSchema.parse('att-stray'))).toBeUndefined();
    expect(await store.getBlob(shared.blobId)).toEqual(shared);
    expect(await store.getAttachment(AttachmentIdSchema.parse('att-prompt'))).toBeDefined();
    expect(await store.getAttachment(AttachmentIdSchema.parse('att-leased'))).toBeDefined();
    expect(await store.getAttachment(AttachmentIdSchema.parse('att-resource'))).toBeDefined();

    const afterExpiry = lease('up-leased', 'leased').expiresAt;
    expect(await store.sweep({ now: afterExpiry, graceBefore: NOW + GRACE })).toEqual([
      leasedOnly.blobId,
    ]);
    expect(await store.getAttachment(AttachmentIdSchema.parse('att-leased'))).toBeUndefined();
    expect(await store.getBlob(leasedOnly.blobId)).toBeUndefined();
    expect(await store.getBlob(viaResource.blobId)).toEqual(viaResource);
  });

  it('reports reachability from a session prompt or resource, not another session', async () => {
    const { database, path, store } = await fixture();
    await store.commitAttachment({ blob: blob('prompt'), attachment: attachment('att-prompt') });
    await store.commitAttachment({
      blob: blob('resource'),
      attachment: attachment('att-resource'),
    });
    await createConversationStore(database.client).persistTurnIntent({
      turn: ConversationTurnSchema.parse({
        turnId: 't-1',
        sessionId: 's-1',
        parentTurnId: null,
        siblingOrdinal: 1,
        input: { type: 'prompt', promptId: 'p-1' },
        runId: 'run-1',
        state: 'preparing',
        createdAt: 1,
      }),
      prompt: PromptRecordSchema.parse({
        promptId: 'p-1',
        blocks: [{ type: 'attachment_ref', attachmentId: 'att-prompt' }],
        contextAttachmentIds: [],
        createdAt: 1,
      }),
      operation: ConversationOperationSchema.parse({
        operationId: 'op-reach',
        sessionId: 's-1',
        kind: 'turn.submit',
        state: 'open',
        createdAt: 1,
      }),
    });
    await createResourceStore(path).save(
      SessionResourceSchema.parse({
        resourceId: 'resource-1',
        sessionId: 's-1',
        direction: 'source',
        name: 'brief.txt',
        kind: 'file',
        status: 'ready',
        locator: { type: 'managed-file', path: '/state/blobs/x' },
        attachmentId: 'att-resource',
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    expect(
      await store.isReachable(SessionIdSchema.parse('s-1'), AttachmentIdSchema.parse('att-prompt')),
    ).toBe(true);
    expect(
      await store.isReachable(
        SessionIdSchema.parse('s-1'),
        AttachmentIdSchema.parse('att-resource'),
      ),
    ).toBe(true);
    expect(
      await store.isReachable(
        SessionIdSchema.parse('s-other'),
        AttachmentIdSchema.parse('att-prompt'),
      ),
    ).toBe(false);
    expect(
      await store.isReachable(
        SessionIdSchema.parse('s-1'),
        AttachmentIdSchema.parse('att-missing'),
      ),
    ).toBe(false);
  });
});
