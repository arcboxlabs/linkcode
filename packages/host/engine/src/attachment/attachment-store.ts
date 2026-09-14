import type {
  AttachmentId,
  AttachmentRecord,
  BlobId,
  BlobRecord,
  SessionId,
  Timestamp,
  UploadId,
  UploadLease,
} from '@linkcode/schema';
import { blobIdFromSha256 } from '@linkcode/schema';
import { falseFn } from 'foxts/noop';

/** An attachment record joined with the blob holding its `original` bytes. */
export interface StoredAttachment extends AttachmentRecord {
  readonly blobId: BlobId;
}

export interface AttachmentCommit {
  readonly blob: BlobRecord;
  readonly attachment: AttachmentRecord;
  /** The lease that staged the bytes; it keeps pinning the new attachment until claimed. */
  readonly uploadId?: UploadId;
}

export interface AttachmentSweepWindow {
  readonly now: Timestamp;
  /** Rows created at or after this instant are never collected: their root may be one
   * transaction away. */
  readonly graceBefore: Timestamp;
}

/**
 * Attachment metadata, reference roots, and upload leases. The daemon implements it on the graph
 * connection so a lease claim rides the submit transaction. `sweep` MUST read its roots — prompt
 * refs, session-resource refs, unexpired leases — inside its own transaction: a claim landing
 * between a root read and the delete would otherwise lose a referenced attachment.
 */
export interface AttachmentStore {
  getAttachment(attachmentId: AttachmentId): Promise<StoredAttachment | undefined>;
  listAttachments(attachmentIds: readonly AttachmentId[]): Promise<StoredAttachment[]>;
  getBlob(blobId: BlobId): Promise<BlobRecord | undefined>;
  getLease(uploadId: UploadId): Promise<UploadLease | undefined>;
  /** Atomic: insert the lease and, when a blob row already carries its declared hash, pin that
   * blob — the returned lease then names it (the dedupe short-circuit). */
  beginUpload(lease: UploadLease): Promise<UploadLease>;
  deleteLease(uploadId: UploadId): Promise<void>;
  /** Atomic: the blob row (if new), the attachment with its `original` variant, and the lease
   * pointed at the attachment. */
  commitAttachment(commit: AttachmentCommit): Promise<void>;
  /** Whether a prompt of a turn in `sessionId`, or a session resource of that session, names the
   * attachment. Integrity, not confidentiality — every peer of this store is one account. */
  isReachable(sessionId: SessionId, attachmentId: AttachmentId): Promise<boolean>;
  /** Atomic reaper: expired leases first; then attachments, then blobs, that nothing roots and
   * that predate the grace window. Returns the blob ids whose bytes the caller must delete. */
  sweep(window: AttachmentSweepWindow): Promise<BlobId[]>;
}

/** Session-scoped root check for the in-memory store. */
export type AttachmentReachability = (sessionId: SessionId, attachmentId: AttachmentId) => boolean;

export class InMemoryAttachmentStore implements AttachmentStore {
  private readonly blobs = new Map<BlobId, BlobRecord>();
  private readonly attachments = new Map<AttachmentId, StoredAttachment>();
  private readonly leases = new Map<UploadId, UploadLease>();

  /** `roots` lists every attachment id a prompt or session resource currently references.
   * `reachable` is the same set sliced by session — used by `attachment.read`. */
  constructor(
    private readonly roots: () => Iterable<AttachmentId> = () => [],
    private readonly reachable: AttachmentReachability = falseFn,
  ) {}

  getAttachment(attachmentId: AttachmentId): Promise<StoredAttachment | undefined> {
    const attachment = this.attachments.get(attachmentId);
    return Promise.resolve(attachment && structuredClone(attachment));
  }

  listAttachments(attachmentIds: readonly AttachmentId[]): Promise<StoredAttachment[]> {
    const found: StoredAttachment[] = [];
    for (let i = 0, len = attachmentIds.length; i < len; i++) {
      const attachment = this.attachments.get(attachmentIds[i]);
      if (attachment) found.push(structuredClone(attachment));
    }
    return Promise.resolve(found);
  }

  getBlob(blobId: BlobId): Promise<BlobRecord | undefined> {
    const blob = this.blobs.get(blobId);
    return Promise.resolve(blob && structuredClone(blob));
  }

  getLease(uploadId: UploadId): Promise<UploadLease | undefined> {
    const lease = this.leases.get(uploadId);
    return Promise.resolve(lease && structuredClone(lease));
  }

  beginUpload(lease: UploadLease): Promise<UploadLease> {
    if (this.leases.has(lease.uploadId)) {
      return Promise.reject(new Error(`Upload lease already exists: ${lease.uploadId}`));
    }
    const blobId = blobIdFromSha256(lease.declaredSha256);
    const pinned = this.blobs.has(blobId) ? { ...lease, blobId } : lease;
    this.leases.set(lease.uploadId, structuredClone(pinned));
    return Promise.resolve(structuredClone(pinned));
  }

  deleteLease(uploadId: UploadId): Promise<void> {
    this.leases.delete(uploadId);
    return Promise.resolve();
  }

  isReachable(sessionId: SessionId, attachmentId: AttachmentId): Promise<boolean> {
    return Promise.resolve(this.reachable(sessionId, attachmentId));
  }

  commitAttachment({ attachment, blob, uploadId }: AttachmentCommit): Promise<void> {
    if (!this.blobs.has(blob.blobId)) this.blobs.set(blob.blobId, structuredClone(blob));
    this.attachments.set(attachment.attachmentId, {
      ...structuredClone(attachment),
      blobId: blob.blobId,
    });
    const lease = uploadId === undefined ? undefined : this.leases.get(uploadId);
    if (lease) {
      this.leases.set(lease.uploadId, {
        ...lease,
        blobId: blob.blobId,
        attachmentId: attachment.attachmentId,
      });
    }
    return Promise.resolve();
  }

  sweep({ graceBefore, now }: AttachmentSweepWindow): Promise<BlobId[]> {
    for (const [uploadId, lease] of this.leases) {
      if (lease.expiresAt <= now) this.leases.delete(uploadId);
    }
    const rooted = new Set<AttachmentId>(this.roots());
    const pinnedBlobs = new Set<BlobId>();
    for (const lease of this.leases.values()) {
      if (lease.attachmentId !== undefined) rooted.add(lease.attachmentId);
      if (lease.blobId !== undefined) pinnedBlobs.add(lease.blobId);
    }
    for (const [attachmentId, attachment] of this.attachments) {
      if (attachment.createdAt < graceBefore && !rooted.has(attachmentId)) {
        this.attachments.delete(attachmentId);
      }
    }
    for (const attachment of this.attachments.values()) pinnedBlobs.add(attachment.blobId);
    const doomed: BlobId[] = [];
    for (const [blobId, blob] of this.blobs) {
      if (blob.createdAt < graceBefore && !pinnedBlobs.has(blobId)) {
        this.blobs.delete(blobId);
        doomed.push(blobId);
      }
    }
    return Promise.resolve(doomed);
  }
}
