import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlobId, UploadLease } from '@linkcode/schema';
import {
  AttachmentIdSchema,
  ConversationOperationSchema,
  ConversationTurnSchema,
  PromptRecordSchema,
  SessionResourceSchema,
  UploadIdSchema,
} from '@linkcode/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryAttachmentStore } from '../attachment/attachment-store';
import { FsBlobStore } from '../attachment/blob-store';
import { ATTACHMENT_GC_GRACE_MS, AttachmentGc, UPLOAD_LEASE_TTL_MS } from '../attachment/gc';
import { InMemoryConversationStore } from '../conversation/conversation-store';
import { InMemoryResourceStore } from '../resource/resource-store';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'linkcode-attachment-gc-'));
  temporaryDirectories.push(root);
  const blobs = new FsBlobStore(root);
  const conversations = new InMemoryConversationStore();
  const resources = new InMemoryResourceStore();
  const store = new InMemoryAttachmentStore(() => [
    ...conversations.referencedAttachmentIds(),
    ...resources.referencedAttachmentIds(),
  ]);
  const clock = { now: 1_000_000 };
  const gc = new AttachmentGc(store, blobs, () => clock.now);

  async function publish(text: string): Promise<BlobId> {
    const bytes = Buffer.from(text);
    const stage = await blobs.stage(`stage-${sha256(bytes).slice(0, 8)}`);
    await stage.write(0, bytes);
    return stage.commit({ sha256: sha256(bytes), sizeBytes: bytes.byteLength });
  }

  async function commit(id: string, text: string, uploadId?: string): Promise<BlobId> {
    const blobId = await publish(text);
    await store.commitAttachment({
      blob: { blobId, sizeBytes: Buffer.byteLength(text), createdAt: clock.now },
      attachment: {
        attachmentId: AttachmentIdSchema.parse(id),
        kind: 'file',
        name: `${id}.txt`,
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(text),
        metadata: {},
        createdAt: clock.now,
      },
      uploadId: uploadId === undefined ? undefined : UploadIdSchema.parse(uploadId),
    });
    return blobId;
  }

  function lease(uploadId: string, text: string): UploadLease {
    return {
      uploadId: UploadIdSchema.parse(uploadId),
      declaredSha256: sha256(Buffer.from(text)),
      declaredSize: Buffer.byteLength(text),
      name: 'draft.txt',
      kind: 'file',
      expiresAt: clock.now + UPLOAD_LEASE_TTL_MS,
      createdAt: clock.now,
    };
  }

  return { blobs, clock, commit, conversations, gc, lease, publish, resources, store };
}

describe('AttachmentGc', () => {
  it('collects only what no prompt, resource, or lease roots, once the grace window passes', async () => {
    const f = await fixture();
    const promptBlob = await f.commit('att-prompt', 'referenced by a prompt');
    const resourceBlob = await f.commit('att-resource', 'referenced by a resource');
    await f.store.beginUpload(f.lease('up-draft', 'held by a lease'));
    const leasedBlob = await f.commit('att-leased', 'held by a lease', 'up-draft');
    const strayBlob = await f.commit('att-stray', 'nothing roots this');

    await f.conversations.persistTurnIntent({
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
    await f.resources.save(
      SessionResourceSchema.parse({
        resourceId: 'resource-1',
        sessionId: 's-1',
        direction: 'source',
        name: 'brief.txt',
        kind: 'file',
        status: 'ready',
        locator: { type: 'managed-file', path: f.blobs.pathOf(resourceBlob) },
        attachmentId: 'att-resource',
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    expect(await f.gc.sweep()).toEqual({ removedBlobs: [] });

    f.clock.now += ATTACHMENT_GC_GRACE_MS + 1;
    expect(await f.gc.sweep()).toEqual({ removedBlobs: [strayBlob] });
    expect(await f.blobs.stat(strayBlob)).toBeUndefined();
    expect(await f.store.getAttachment(AttachmentIdSchema.parse('att-stray'))).toBeUndefined();
    const survivors = await Promise.all(
      [promptBlob, resourceBlob, leasedBlob].map((blobId) => f.blobs.stat(blobId)),
    );
    expect(survivors.every(Boolean)).toBe(true);

    f.clock.now += UPLOAD_LEASE_TTL_MS;
    expect(await f.gc.sweep()).toEqual({ removedBlobs: [leasedBlob] });
    expect(await f.store.getLease(UploadIdSchema.parse('up-draft'))).toBeUndefined();
    expect(await f.store.getAttachment(AttachmentIdSchema.parse('att-prompt'))).toMatchObject({
      blobId: promptBlob,
    });
    expect(await f.store.getAttachment(AttachmentIdSchema.parse('att-resource'))).toMatchObject({
      blobId: resourceBlob,
    });
  });

  it('pins an existing blob at begin so a dedupe hit survives the reaper', async () => {
    const f = await fixture();
    const blobId = await f.commit('att-old', 'shared bytes');
    f.clock.now += ATTACHMENT_GC_GRACE_MS + 1;
    const pinned = await f.store.beginUpload(f.lease('up-dedupe', 'shared bytes'));
    expect(pinned.blobId).toBe(blobId);

    expect(await f.gc.sweep()).toEqual({ removedBlobs: [] });
    expect(await f.store.getAttachment(AttachmentIdSchema.parse('att-old'))).toBeUndefined();
    expect(await f.store.getBlob(blobId)).toBeDefined();
    expect(await f.blobs.stat(blobId)).toBeDefined();
    await expect(f.store.beginUpload(f.lease('up-dedupe', 'shared bytes'))).rejects.toThrow(
      'already exists',
    );
  });

  it('boot sweep drops staging files and bytes that have no blob row', async () => {
    const f = await fixture();
    const kept = await f.commit('att-kept', 'row and bytes');
    const orphan = await f.publish('bytes without a row');
    const staged = await f.blobs.stage('never-committed');
    await staged.write(0, Buffer.from('half an upload'));

    const report = await f.gc.bootSweep();
    expect(report.removedBlobs).toEqual([orphan]);
    expect(await f.blobs.list()).toEqual([kept]);
    await expect(stat(join(f.blobs.pathOf(kept), '..', '..', '..', 'tmp'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      f.store.getAttachment(AttachmentIdSchema.parse('att-kept')),
    ).resolves.toBeDefined();
  });

  it('does not unlink a blob that is re-committed after the reaper transaction', async () => {
    const f = await fixture();
    const blobId = await f.commit('att-old', 'shared bytes');
    f.clock.now += ATTACHMENT_GC_GRACE_MS + 1;

    const originalSweep = f.store.sweep.bind(f.store);
    f.store.sweep = async (window) => {
      const doomed = await originalSweep(window);
      await f.commit('att-new', 'shared bytes');
      return doomed;
    };

    expect(await f.gc.sweep()).toEqual({ removedBlobs: [] });
    expect(await f.blobs.stat(blobId)).toBeDefined();
    expect(await f.store.getAttachment(AttachmentIdSchema.parse('att-new'))).toMatchObject({
      blobId,
    });
  });
});
