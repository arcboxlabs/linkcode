import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AttachmentId, UploadId } from '@linkcode/schema';
import { AttachmentIdSchema, blobIdFromSha256, SessionIdSchema } from '@linkcode/schema';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryAttachmentStore } from '../attachment/attachment-store';
import { FsBlobStore } from '../attachment/blob-store';
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

async function makeService(reachableIds: AttachmentId[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'linkcode-upload-'));
  temporaryDirectories.push(root);
  const reachable = new Set(reachableIds);
  const blobs = new FsBlobStore(join(root, 'blobs'));
  const attachments = new InMemoryAttachmentStore(
    () => reachable,
    (sid, id) => sid === sessionId && reachable.has(id),
  );
  const uploads = new AttachmentUploadService(blobs, attachments);
  return { attachments, blobs, reachable, uploads };
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
