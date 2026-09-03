import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blobIdFromSha256 } from '@linkcode/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { BlobIntegrityError, FsBlobStore } from '../attachment/blob-store';
import { declaredMimeTypeMatches, sniffImageMimeType } from '../attachment/mime-sniff';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function storeInTempDir(): Promise<{ store: FsBlobStore; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'linkcode-blob-store-'));
  temporaryDirectories.push(root);
  return { store: new FsBlobStore(root), root };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('FsBlobStore', () => {
  it('publishes verified bytes under their hash and dedupes identical commits', async () => {
    const { store, root } = await storeInTempDir();
    const bytes = Buffer.from('hello attachment store');
    const expected = { sha256: sha256(bytes), sizeBytes: bytes.byteLength };

    const first = await store.stage('upload-1');
    await first.write(0, bytes.subarray(0, 5));
    await first.write(5, bytes.subarray(5));
    const blobId = await first.commit(expected);

    expect(blobId).toBe(blobIdFromSha256(expected.sha256));
    expect(store.pathOf(blobId)).toBe(
      join(root, 'sha256', expected.sha256.slice(0, 2), expected.sha256.slice(2)),
    );
    expect(await readFile(store.pathOf(blobId))).toEqual(bytes);
    expect(await store.stat(blobId)).toEqual({ sizeBytes: bytes.byteLength });
    expect((await stat(store.pathOf(blobId))).mode & 0o222).toBe(0);

    const second = await store.stage('upload-2');
    await second.write(0, bytes);
    expect(await second.commit(expected)).toBe(blobId);
    expect(await store.list()).toEqual([blobId]);
    expect(await readdir(join(root, 'tmp'))).toEqual([]);
  });

  it('refuses a size or hash mismatch and leaves nothing behind', async () => {
    const { store, root } = await storeInTempDir();
    const bytes = Buffer.from('payload');

    const shortStage = await store.stage('short');
    await shortStage.write(0, bytes);
    await expect(
      shortStage.commit({ sha256: sha256(bytes), sizeBytes: bytes.byteLength + 1 }),
    ).rejects.toBeInstanceOf(BlobIntegrityError);

    const wrongHash = await store.stage('wrong-hash');
    await wrongHash.write(0, bytes);
    await expect(
      wrongHash.commit({ sha256: sha256(Buffer.from('other')), sizeBytes: bytes.byteLength }),
    ).rejects.toBeInstanceOf(BlobIntegrityError);

    const aborted = await store.stage('aborted');
    await aborted.write(0, bytes);
    await aborted.abort();

    expect(await readdir(join(root, 'tmp'))).toEqual([]);
    expect(await store.list()).toEqual([]);
    await expect(store.stage('../escape')).rejects.toThrow('Invalid upload id');
  });

  it('purges staging orphans and deletes blobs on request', async () => {
    const { store, root } = await storeInTempDir();
    const bytes = Buffer.from('to be deleted');
    const stage = await store.stage('committed');
    await stage.write(0, bytes);
    const blobId = await stage.commit({ sha256: sha256(bytes), sizeBytes: bytes.byteLength });
    const orphan = await store.stage('orphan');
    await orphan.write(0, bytes);

    await store.purgeStaging();
    await expect(stat(join(root, 'tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await store.list()).toEqual([blobId]);

    await store.delete(blobId);
    expect(await store.stat(blobId)).toBeUndefined();
    expect(await store.list()).toEqual([]);
    await expect(store.delete(blobId)).resolves.toBeUndefined();
  });
});

describe('mime sniff', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);

  it('recognizes the supported image types and nothing else', () => {
    expect(sniffImageMimeType(png)).toBe('image/png');
    expect(sniffImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageMimeType(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffImageMimeType(webp)).toBe('image/webp');
    expect(sniffImageMimeType(Buffer.from('RIFF....WAVE'))).toBeUndefined();
    expect(sniffImageMimeType(Buffer.from('%PDF-1.7'))).toBeUndefined();
    expect(sniffImageMimeType(new Uint8Array(0))).toBeUndefined();
  });

  it('holds image declarations to their bytes and trusts the rest', () => {
    expect(declaredMimeTypeMatches('image/png', png)).toBe(true);
    expect(declaredMimeTypeMatches('image/jpeg', png)).toBe(false);
    expect(declaredMimeTypeMatches('image/svg+xml', Buffer.from('<svg/>'))).toBe(false);
    expect(declaredMimeTypeMatches('application/pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    expect(declaredMimeTypeMatches('text/plain', png)).toBe(true);
  });
});
