import type { BlobId } from '@linkcode/schema';
import { Effect, Schedule } from 'effect';
import type { AttachmentStore } from './attachment-store';
import type { BlobStore } from './blob-store';

/** A draft's upload outlives any composer session, not a forgotten one. */
export const UPLOAD_LEASE_TTL_MS = 24 * 60 * 60 * 1000;
/** Rows younger than this are never collected: their root may be one transaction away. */
export const ATTACHMENT_GC_GRACE_MS = 60 * 60 * 1000;
export const ATTACHMENT_GC_INTERVAL_MS = 60 * 60 * 1000;

export interface AttachmentGcReport {
  readonly removedBlobs: BlobId[];
}

/** Reference-rooted collection: the store's transaction decides, then bytes follow. */
export class AttachmentGc {
  constructor(
    private readonly store: AttachmentStore,
    private readonly blobs: BlobStore,
    private readonly clock: () => number = Date.now,
  ) {}

  /** A failed unlink leaves an orphan file the next boot sweep removes. */
  async sweep(): Promise<AttachmentGcReport> {
    const now = this.clock();
    const removedBlobs = await this.store.sweep({
      now,
      graceBefore: now - ATTACHMENT_GC_GRACE_MS,
    });
    for (let i = 0, len = removedBlobs.length; i < len; i++) {
      // eslint-disable-next-line no-await-in-loop -- sequential unlinks of a short list
      await this.blobs.delete(removedBlobs[i]);
    }
    return { removedBlobs };
  }

  /**
   * Run before requests are accepted: no upload survives a restart, so staging goes wholesale;
   * then a sweep; then bytes with no blob row (a crash between publish and the row insert).
   * Safe only while no commit can be publishing — that is what the boot ordering guarantees.
   */
  async bootSweep(): Promise<AttachmentGcReport> {
    await this.blobs.purgeStaging();
    const report = await this.sweep();
    const onDisk = await this.blobs.list();
    const orphans: BlobId[] = [];
    for (let i = 0, len = onDisk.length; i < len; i++) {
      const blobId = onDisk[i];
      // eslint-disable-next-line no-await-in-loop -- one row lookup per file on disk
      if (await this.store.getBlob(blobId)) continue;
      // eslint-disable-next-line no-await-in-loop -- same
      await this.blobs.delete(blobId);
      orphans.push(blobId);
    }
    return { removedBlobs: [...report.removedBlobs, ...orphans] };
  }

  /** One sweep per interval until interrupted; a failed sweep is logged and the cadence goes on. */
  cadence(): Effect.Effect<void> {
    const sweep = Effect.tryPromise({ try: () => this.sweep(), catch: (error) => error }).pipe(
      Effect.catch((error) => Effect.logError('Attachment GC sweep failed', error)),
      Effect.asVoid,
    );
    return Effect.sleep(ATTACHMENT_GC_INTERVAL_MS).pipe(
      Effect.andThen(sweep.pipe(Effect.repeat(Schedule.spaced(ATTACHMENT_GC_INTERVAL_MS)))),
      Effect.asVoid,
    );
  }
}
