import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AttachmentId, UploadId } from '@linkcode/schema';
import {
  ATTACHMENT_UPLOAD_CHUNK_BYTES,
  AttachmentIdSchema,
  blobIdFromSha256,
  SessionIdSchema,
} from '@linkcode/schema';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryAttachmentStore } from '../attachment/attachment-store';
import { FsBlobStore } from '../attachment/blob-store';
import { AttachmentGc, UPLOAD_LEASE_TTL_MS } from '../attachment/gc';
import { AttachmentIoMutex } from '../attachment/io-mutex';
import { AttachmentUploadService } from '../attachment/upload-service';

const temporaryDirectories: string[] = [];
const sessionId = SessionIdSchema.parse('session-1');
const otherSession = SessionIdSchema.parse('session-2');

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function makeService(reachableIds: AttachmentId[] = [], clock?: () => number) {
  const root = await mkdtemp(join(tmpdir(), 'linkcode-upload-'));
  temporaryDirectories.push(root);
  const reachable = new Set(reachableIds);
  const blobs = new FsBlobStore(join(root, 'blobs'));
  const attachments = new InMemoryAttachmentStore(
    () => reachable,
    (sid, id) => sid === sessionId && reachable.has(id),
  );
  const uploads = new AttachmentUploadService(blobs, attachments, undefined, clock);
  return { attachments, blobs, reachable, root, uploads };
}

function stagingEntries(root: string): Promise<string[]> {
  return readdir(join(root, 'blobs', 'tmp'));
}

function chunksOf(bytes: Buffer): Array<{ offset: number; data: string }> {
  const chunks: Array<{ offset: number; data: string }> = [];
  for (let offset = 0; offset < bytes.byteLength; offset += ATTACHMENT_UPLOAD_CHUNK_BYTES) {
    const end = Math.min(offset + ATTACHMENT_UPLOAD_CHUNK_BYTES, bytes.byteLength);
    chunks.push({ offset, data: bytes.subarray(offset, end).toString('base64') });
  }
  return chunks;
}

async function run<A>(effect: Effect.Effect<A, unknown>): Promise<A> {
  return Effect.runPromise(effect);
}

describe('AttachmentUploadService', () => {
  it('uploads bytes, then reads them only from a session that references the attachment', async () => {
    const { reachable, uploads } = await makeService();
    const bytes = Buffer.from('hello attachment');
    const begun = await run(
      uploads.begin({
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'note.txt',
        mimeType: 'text/plain',
        attachmentKind: 'file',
      }),
    );
    expect(begun.state).toBe('ready');
    const ack = await run(uploads.chunk(begun.uploadId, 0, bytes.toString('base64')));
    expect(ack.receivedBytes).toBe(bytes.byteLength);
    const committed = await run(uploads.commit(begun.uploadId));
    reachable.add(committed.attachmentId);

    const page = await run(uploads.read(sessionId, committed.attachmentId, 0, bytes.byteLength));
    expect(Buffer.from(page.data, 'base64').toString()).toBe('hello attachment');
    expect(page.eof).toBe(true);
    expect(page.blobId).toBe(blobIdFromSha256(sha256(bytes)));

    await expect(
      run(uploads.read(otherSession, committed.attachmentId, 0, 4)),
    ).rejects.toMatchObject({ _tag: 'RequestError', code: 'not_found' });
  });

  it('short-circuits begin when the blob already exists on disk', async () => {
    const { uploads } = await makeService();
    const bytes = Buffer.from('same screenshot twice');
    const input = {
      declaredSha256: sha256(bytes),
      declaredSize: bytes.byteLength,
      name: 'shot.png',
      mimeType: 'text/plain',
      attachmentKind: 'file',
    };
    const first = await run(uploads.begin(input));
    await run(uploads.chunk(first.uploadId, 0, bytes.toString('base64')));
    const committed = await run(uploads.commit(first.uploadId));

    const second = await run(uploads.begin({ ...input, name: 'copy.png' }));
    expect(second.state).toBe('exists');
    const again = await run(uploads.commit(second.uploadId));
    expect(again.blobId).toBe(committed.blobId);
    expect(again.attachmentId).not.toBe(committed.attachmentId);
  });

  it('treats a missing blob file as ready even when the row is pinned', async () => {
    const { blobs, uploads } = await makeService();
    const bytes = Buffer.from('will vanish');
    const input = {
      declaredSha256: sha256(bytes),
      declaredSize: bytes.byteLength,
      name: 'gone.bin',
      attachmentKind: 'file',
    };
    const first = await run(uploads.begin(input));
    await run(uploads.chunk(first.uploadId, 0, bytes.toString('base64')));
    const committed = await run(uploads.commit(first.uploadId));
    await blobs.delete(committed.blobId);

    const again = await run(uploads.begin(input));
    expect(again.state).toBe('ready');
    await run(uploads.chunk(again.uploadId, 0, bytes.toString('base64')));
    const restored = await run(uploads.commit(again.uploadId));
    expect(restored.blobId).toBe(committed.blobId);
    expect(await blobs.stat(restored.blobId)).toEqual({ sizeBytes: bytes.byteLength });
  });

  it('rejects a wrong offset, a hash mismatch, an oversize claim, and a path-shaped id', async () => {
    const { uploads } = await makeService();
    const bytes = Buffer.from('payload');
    const begun = await run(
      uploads.begin({
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'payload.bin',
        attachmentKind: 'file',
      }),
    );
    await expect(
      run(uploads.chunk(begun.uploadId, 1, bytes.toString('base64'))),
    ).rejects.toMatchObject({ _tag: 'RequestError', code: 'invalid_request' });

    const wrongHash = await run(
      uploads.begin({
        declaredSha256: sha256(Buffer.from('other')),
        declaredSize: bytes.byteLength,
        name: 'wrong.bin',
        attachmentKind: 'file',
      }),
    );
    await run(uploads.chunk(wrongHash.uploadId, 0, bytes.toString('base64')));
    await expect(run(uploads.commit(wrongHash.uploadId))).rejects.toMatchObject({
      _tag: 'RequestError',
      code: 'invalid_request',
    });

    await expect(
      run(
        uploads.begin({
          declaredSha256: sha256(bytes),
          declaredSize: 9 * 1024 * 1024,
          name: 'huge.bin',
          attachmentKind: 'file',
        }),
      ),
    ).rejects.toMatchObject({ _tag: 'RequestError', code: 'limit_exceeded' });

    await expect(run(uploads.chunk('upl-../escape' as UploadId, 0, 'YQ=='))).rejects.toMatchObject({
      _tag: 'RequestError',
      code: 'not_found',
    });
  });

  it('replays begin by operationId and aborts a live stage', async () => {
    const { attachments, uploads } = await makeService();
    const bytes = Buffer.from('draft');
    const first = await run(
      uploads.begin({
        operationId: 'op-1',
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'draft.bin',
        attachmentKind: 'file',
      }),
    );
    const replayed = await run(
      uploads.begin({
        operationId: 'op-1',
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'draft.bin',
        attachmentKind: 'file',
      }),
    );
    expect(replayed.uploadId).toBe(first.uploadId);
    await run(uploads.abort(first.uploadId));
    expect(await attachments.getLease(first.uploadId)).toBeUndefined();
    await expect(
      run(uploads.chunk(first.uploadId, 0, bytes.toString('base64'))),
    ).rejects.toMatchObject({ _tag: 'RequestError', code: 'not_found' });
  });

  it('accepts the whole credit window in flight, the way the client sends it', async () => {
    const { uploads } = await makeService();
    // Three chunks so the client's two-chunk window overlaps a write on both sides.
    const bytes = Buffer.alloc(ATTACHMENT_UPLOAD_CHUNK_BYTES * 2 + 11, 7);
    const begun = await run(
      uploads.begin({
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'window.bin',
        attachmentKind: 'file',
      }),
    );
    const acks = await Promise.all(
      chunksOf(bytes).map((chunk) => run(uploads.chunk(begun.uploadId, chunk.offset, chunk.data))),
    );
    expect(acks.at(-1)?.receivedBytes).toBe(bytes.byteLength);
    const committed = await run(uploads.commit(begun.uploadId));
    expect(committed.blobId).toBe(blobIdFromSha256(sha256(bytes)));
  });

  it('refuses a dedupe hit whose stored bytes are not the declared size', async () => {
    const { uploads } = await makeService();
    const bytes = Buffer.from('eleven byte');
    const stored = await run(
      uploads.begin({
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'honest.bin',
        attachmentKind: 'file',
      }),
    );
    await run(uploads.chunk(stored.uploadId, 0, bytes.toString('base64')));
    await run(uploads.commit(stored.uploadId));

    // Same hash, a size that never matched the bytes, and no chunks sent at all.
    const lying = await run(
      uploads.begin({
        declaredSha256: sha256(bytes),
        declaredSize: 4096,
        name: 'liar.bin',
        attachmentKind: 'file',
      }),
    );
    expect(lying.state).toBe('ready');
    await expect(run(uploads.commit(lying.uploadId))).rejects.toMatchObject({
      _tag: 'RequestError',
      code: 'invalid_request',
    });
  });

  it('keeps a rowed blob on disk when a same-hash upload fails to publish its record', async () => {
    const { attachments, blobs, reachable, uploads } = await makeService();
    const bytes = Buffer.from('the same screenshot twice');
    const input = {
      declaredSha256: sha256(bytes),
      declaredSize: bytes.byteLength,
      attachmentKind: 'file',
    };
    // Both begins land before either commit, so neither sees a blob row and both stage bytes.
    const a = await run(uploads.begin({ ...input, name: 'a.png' }));
    const b = await run(uploads.begin({ ...input, name: 'b.png' }));
    await run(uploads.chunk(a.uploadId, 0, bytes.toString('base64')));
    await run(uploads.chunk(b.uploadId, 0, bytes.toString('base64')));
    const first = await run(uploads.commit(a.uploadId));
    reachable.add(first.attachmentId);

    const commitAttachment = attachments.commitAttachment.bind(attachments);
    attachments.commitAttachment = () => Promise.reject(new Error('row insert failed'));
    await expect(run(uploads.commit(b.uploadId))).rejects.toBeDefined();
    attachments.commitAttachment = commitAttachment;

    expect(await blobs.stat(first.blobId)).toEqual({ sizeBytes: bytes.byteLength });
    const page = await run(uploads.read(sessionId, first.attachmentId, 0, bytes.byteLength));
    expect(Buffer.from(page.data, 'base64').toString()).toBe('the same screenshot twice');
  });

  it('reads no further than the bytes on disk and says so typed', async () => {
    const { blobs, reachable, uploads } = await makeService();
    const bytes = Buffer.from('full length payload');
    const begun = await run(
      uploads.begin({
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'truncated.bin',
        attachmentKind: 'file',
      }),
    );
    await run(uploads.chunk(begun.uploadId, 0, bytes.toString('base64')));
    const committed = await run(uploads.commit(begun.uploadId));
    reachable.add(committed.attachmentId);
    // Bitrot or a half-finished GC unlink: the row outlives some of its bytes.
    const path = blobs.pathOf(committed.blobId);
    await rm(path, { force: true });
    await writeFile(path, bytes.subarray(0, 4));

    await expect(
      run(uploads.read(sessionId, committed.attachmentId, 4, bytes.byteLength)),
    ).rejects.toMatchObject({ _tag: 'RequestError', code: 'not_found' });
  });

  it('releases the staging handle of an expired lease and of a rejected commit', async () => {
    let now = 1_000;
    const { blobs, root, uploads } = await makeService([], () => now);
    const bytes = Buffer.from('abandoned');
    const abandoned = await run(
      uploads.begin({
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'abandoned.bin',
        attachmentKind: 'file',
      }),
    );
    expect(await stagingEntries(root)).toEqual([abandoned.uploadId]);

    // A commit that cannot succeed ends the upload: no resume frame exists to continue it.
    const doomed = await run(
      uploads.begin({
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'doomed.bin',
        attachmentKind: 'file',
      }),
    );
    await expect(run(uploads.commit(doomed.uploadId))).rejects.toMatchObject({
      _tag: 'RequestError',
      code: 'invalid_request',
    });
    await expect(
      run(uploads.chunk(doomed.uploadId, 0, bytes.toString('base64'))),
    ).rejects.toMatchObject({ _tag: 'RequestError', code: 'conflict' });

    now += UPLOAD_LEASE_TTL_MS + 1;
    const fresh = await run(
      uploads.begin({
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'fresh.bin',
        attachmentKind: 'file',
      }),
    );
    expect(await stagingEntries(root)).toEqual([fresh.uploadId]);
    // The lease row outlives the handle until the GC's own sweep; the id is known but dead.
    await expect(
      run(uploads.chunk(abandoned.uploadId, 0, bytes.toString('base64'))),
    ).rejects.toMatchObject({ _tag: 'RequestError', code: 'conflict' });
    expect(await blobs.stat(blobIdFromSha256(sha256(bytes)))).toBeUndefined();
  });

  it('rejects a sniffed image whose bytes are not that type', async () => {
    const { uploads } = await makeService();
    const bytes = Buffer.from('not a png');
    const begun = await run(
      uploads.begin({
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'fake.png',
        mimeType: 'image/png',
        attachmentKind: 'image',
      }),
    );
    await run(uploads.chunk(begun.uploadId, 0, bytes.toString('base64')));
    await expect(run(uploads.commit(begun.uploadId))).rejects.toMatchObject({
      _tag: 'RequestError',
      code: 'invalid_request',
    });
  });

  it('refuses a dedupe commit whose lease expired and whose blob the reaper unlinked', async () => {
    let now = 1000;
    const root = await mkdtemp(join(tmpdir(), 'linkcode-upload-dangling-'));
    temporaryDirectories.push(root);
    const blobs = new FsBlobStore(join(root, 'blobs'));
    const attachments = new InMemoryAttachmentStore();
    const io = new AttachmentIoMutex();
    const uploads = new AttachmentUploadService(blobs, attachments, io, () => now);
    const gc = new AttachmentGc(attachments, blobs, () => now, io);
    const bytes = Buffer.from('plain text payload');
    const input = {
      declaredSha256: sha256(bytes),
      declaredSize: bytes.byteLength,
      name: 'a.txt',
      mimeType: 'text/plain',
      attachmentKind: 'file',
    };

    const first = await run(uploads.begin(input));
    await run(uploads.chunk(first.uploadId, 0, bytes.toString('base64')));
    const committed = await run(uploads.commit(first.uploadId));
    const second = await run(uploads.begin(input));
    expect(second.state).toBe('exists');

    now += UPLOAD_LEASE_TTL_MS + 1;
    expect((await gc.sweep()).removedBlobs).toEqual([committed.blobId]);
    expect(await blobs.stat(committed.blobId)).toBeUndefined();

    await expect(run(uploads.commit(second.uploadId))).rejects.toMatchObject({
      _tag: 'RequestError',
      code: 'conflict',
    });
    expect(await attachments.getBlob(committed.blobId)).toBeUndefined();
  });

  it('refuses a commit whose lease the store already dropped, writing no row', async () => {
    const { attachments, uploads } = await makeService();
    const bytes = Buffer.from('lease dropped underneath');
    const begun = await run(
      uploads.begin({
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'late.bin',
        attachmentKind: 'file',
      }),
    );
    await run(uploads.chunk(begun.uploadId, 0, bytes.toString('base64')));
    await attachments.deleteLease(begun.uploadId);
    await expect(run(uploads.commit(begun.uploadId))).rejects.toMatchObject({
      _tag: 'RequestError',
      code: 'conflict',
    });
    expect(await attachments.getBlob(blobIdFromSha256(sha256(bytes)))).toBeUndefined();
  });

  it('keeps only the sniff head of the first chunk, not the whole decoded buffer', async () => {
    const { uploads } = await makeService();
    const bytes = Buffer.alloc(ATTACHMENT_UPLOAD_CHUNK_BYTES + 5, 1);
    const begun = await run(
      uploads.begin({
        declaredSha256: sha256(bytes),
        declaredSize: bytes.byteLength,
        name: 'big.bin',
        attachmentKind: 'file',
      }),
    );
    await run(uploads.chunk(begun.uploadId, 0, chunksOf(bytes)[0].data));
    const live = (uploads as unknown as { live: Map<string, { head: Uint8Array }> }).live.get(
      begun.uploadId,
    );
    expect(live?.head.buffer.byteLength).toBeLessThanOrEqual(16);
  });
});

describe('in-memory attachment reachability', () => {
  it('is false until the session-scoped callback says otherwise', async () => {
    const id = AttachmentIdSchema.parse('att-1');
    const store = new InMemoryAttachmentStore(
      () => [id],
      (sid) => sid === sessionId,
    );
    expect(await store.isReachable(sessionId, id)).toBe(true);
    expect(await store.isReachable(otherSession, id)).toBe(false);
  });
});
