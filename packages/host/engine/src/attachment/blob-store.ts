import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { chmod, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BlobId } from '@linkcode/schema';
import { blobIdFromSha256 } from '@linkcode/schema';

const BLOB_ID_PREFIX = 'sha256:';
const rShard = /^[0-9a-f]{2}$/;
const rShardRest = /^[0-9a-f]{62}$/;
const rUploadId = /^[\w-]{1,128}$/;

/** The declared size or SHA-256 did not match the staged bytes; the staging file is gone. */
export class BlobIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BlobIntegrityError';
  }
}

/**
 * Content-addressed byte storage. Dedupe-by-hash is scoped to one trust domain: every peer of
 * this store is the same account, so a known hash counts as proof of possession. A multi-tenant
 * implementation must scope dedupe per tenant or demand real proof-of-possession.
 */
export interface BlobStore {
  /** Absolute path for same-host consumers (materialization, hosted files); existence not implied. */
  pathOf(blobId: BlobId): string;
  stat(blobId: BlobId): Promise<{ sizeBytes: number } | undefined>;
  /** Open staging for one upload; readers cannot observe the bytes until `commit`. */
  stage(uploadId: string): Promise<BlobStage>;
  delete(blobId: BlobId): Promise<void>;
  /** Every committed blob on disk — the "on disk" side of the boot mark-and-sweep. */
  list(): Promise<BlobId[]>;
  /** Drop every staging file: no upload survives a restart. */
  purgeStaging(): Promise<void>;
}

export interface BlobStage {
  write(offset: number, chunk: Uint8Array): Promise<void>;
  /** Verify size and SHA-256, then publish with one same-volume atomic rename. */
  commit(expected: { sha256: string; sizeBytes: number }): Promise<BlobId>;
  abort(): Promise<void>;
}

class FsBlobStage implements BlobStage {
  private handle: FileHandle | undefined;

  constructor(
    private readonly store: FsBlobStore,
    private readonly path: string,
    handle: FileHandle,
  ) {
    this.handle = handle;
  }

  async write(offset: number, chunk: Uint8Array): Promise<void> {
    if (!this.handle) throw new Error('Blob stage is closed');
    await this.handle.write(chunk, 0, chunk.byteLength, offset);
  }

  async commit(expected: { sha256: string; sizeBytes: number }): Promise<BlobId> {
    await this.close();
    const sizeBytes = (await stat(this.path)).size;
    const sha256 = await sha256OfFile(this.path);
    if (sizeBytes !== expected.sizeBytes || sha256 !== expected.sha256.toLowerCase()) {
      await rm(this.path, { force: true });
      throw new BlobIntegrityError(
        sizeBytes === expected.sizeBytes
          ? 'Uploaded bytes do not match the declared SHA-256'
          : `Uploaded ${sizeBytes} bytes, declared ${expected.sizeBytes}`,
      );
    }
    const blobId = blobIdFromSha256(sha256);
    await this.store.publish(this.path, blobId);
    return blobId;
  }

  async abort(): Promise<void> {
    await this.close();
    await rm(this.path, { force: true });
  }

  private async close(): Promise<void> {
    const handle = this.handle;
    this.handle = undefined;
    await handle?.close();
  }
}

/** `<root>/sha256/ab/cdef…` for committed blobs, `<root>/tmp/<uploadId>` while staging. */
export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  pathOf(blobId: BlobId): string {
    const hex = blobId.slice(BLOB_ID_PREFIX.length);
    return join(this.root, 'sha256', hex.slice(0, 2), hex.slice(2));
  }

  async stat(blobId: BlobId): Promise<{ sizeBytes: number } | undefined> {
    try {
      const info = await stat(this.pathOf(blobId));
      return info.isFile() ? { sizeBytes: info.size } : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async stage(uploadId: string): Promise<BlobStage> {
    if (!rUploadId.test(uploadId)) throw new Error(`Invalid upload id: ${uploadId}`);
    const dir = join(this.root, 'tmp');
    await mkdir(dir, { recursive: true });
    const path = join(dir, uploadId);
    return new FsBlobStage(this, path, await open(path, 'w'));
  }

  async delete(blobId: BlobId): Promise<void> {
    await rm(this.pathOf(blobId), { force: true });
  }

  async list(): Promise<BlobId[]> {
    const ids: BlobId[] = [];
    const shards = await readdirOrEmpty(join(this.root, 'sha256'));
    for (let i = 0, len = shards.length; i < len; i++) {
      const shard = shards[i];
      if (!rShard.test(shard)) continue;
      // eslint-disable-next-line no-await-in-loop -- one directory at a time keeps memory flat
      const entries = await readdirOrEmpty(join(this.root, 'sha256', shard));
      for (let j = 0, jlen = entries.length; j < jlen; j++) {
        const rest = entries[j];
        if (rShardRest.test(rest)) ids.push(blobIdFromSha256(`${shard}${rest}`));
      }
    }
    return ids;
  }

  async purgeStaging(): Promise<void> {
    await rm(join(this.root, 'tmp'), { recursive: true, force: true });
  }

  /** Publish a verified staging file. Losing the rename race to identical bytes is success. */
  async publish(stagingPath: string, blobId: BlobId): Promise<void> {
    const dest = this.pathOf(blobId);
    await mkdir(dirname(dest), { recursive: true });
    await chmod(stagingPath, 0o444);
    try {
      await rename(stagingPath, dest);
    } catch (error) {
      if ((await this.stat(blobId)) === undefined) throw error;
      // Dest existing is not proof of identical bytes: Windows rename does not replace a
      // read-only dest, so a truncated or bitrot file would otherwise count as success.
      const existing = await sha256OfFile(dest);
      const expected = blobId.slice(BLOB_ID_PREFIX.length);
      await rm(stagingPath, { force: true });
      if (existing !== expected) {
        throw new BlobIntegrityError('Existing blob bytes do not match the declared SHA-256', {
          cause: error,
        });
      }
    }
  }
}

async function readdirOrEmpty(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array);
  return hash.digest('hex');
}
