import type {
  AttachmentCommit,
  AttachmentStore,
  AttachmentSweepWindow,
  StoredAttachment,
} from '@linkcode/engine';
import type {
  AttachmentId,
  BlobId,
  BlobRecord,
  SessionId,
  UploadId,
  UploadLease,
} from '@linkcode/schema';
import {
  AttachmentRecordSchema,
  BlobIdSchema,
  BlobRecordSchema,
  blobIdFromSha256,
  UploadLeaseSchema,
} from '@linkcode/schema';
import { and, eq, inArray, isNotNull, lt, lte, notInArray } from 'drizzle-orm';
import type { DaemonDatabaseClient } from './db/database';
import {
  attachmentBlobs,
  attachments,
  blobs,
  conversationTurns,
  promptAttachmentRefs,
  sessionResources,
  uploadLeases,
} from './db/schema';

const ORIGINAL_VARIANT = 'original';

type AttachmentRow = typeof attachments.$inferSelect;
type LeaseRow = typeof uploadLeases.$inferSelect;

/**
 * SQLite-backed `AttachmentStore` on the daemon's shared graph connection: the reaper reads its
 * roots inside its own transaction, and the conversation store's submit transaction claims leases.
 */
export function createAttachmentStore(db: DaemonDatabaseClient): AttachmentStore {
  function list(attachmentIds: readonly AttachmentId[]): StoredAttachment[] {
    if (attachmentIds.length === 0) return [];
    const rows = db
      .select({ attachment: attachments, blobId: attachmentBlobs.blobId })
      .from(attachments)
      .innerJoin(
        attachmentBlobs,
        and(
          eq(attachmentBlobs.attachmentId, attachments.attachmentId),
          eq(attachmentBlobs.variant, ORIGINAL_VARIANT),
        ),
      )
      .where(inArray(attachments.attachmentId, Array.from(attachmentIds)))
      .all();
    return rows.map((row) => toStoredAttachment(row.attachment, row.blobId));
  }

  return {
    getAttachment(attachmentId: AttachmentId): Promise<StoredAttachment | undefined> {
      return Promise.resolve(list([attachmentId])[0]);
    },

    listAttachments(attachmentIds: readonly AttachmentId[]): Promise<StoredAttachment[]> {
      return Promise.resolve(list(attachmentIds));
    },

    getBlob(blobId: BlobId): Promise<BlobRecord | undefined> {
      const row = db.select().from(blobs).where(eq(blobs.blobId, blobId)).get();
      return Promise.resolve(row ? BlobRecordSchema.parse(row) : undefined);
    },

    getLease(uploadId: UploadId): Promise<UploadLease | undefined> {
      const row = db.select().from(uploadLeases).where(eq(uploadLeases.uploadId, uploadId)).get();
      return Promise.resolve(row ? toLease(row) : undefined);
    },

    beginUpload(lease: UploadLease): Promise<UploadLease> {
      const pinned = db.transaction((tx) => {
        const declared = blobIdFromSha256(lease.declaredSha256);
        const existing = tx
          .select({ blobId: blobs.blobId })
          .from(blobs)
          .where(eq(blobs.blobId, declared))
          .get();
        const row: UploadLease = existing ? { ...lease, blobId: declared } : lease;
        // Plain insert: a reused upload id conflicts instead of silently re-leasing.
        tx.insert(uploadLeases).values(toLeaseRow(row)).run();
        return row;
      });
      return Promise.resolve(pinned);
    },

    deleteLease(uploadId: UploadId): Promise<void> {
      db.delete(uploadLeases).where(eq(uploadLeases.uploadId, uploadId)).run();
      return Promise.resolve();
    },

    isReachable(sessionId: SessionId, attachmentId: AttachmentId): Promise<boolean> {
      const fromPrompt = db
        .select({ id: promptAttachmentRefs.attachmentId })
        .from(promptAttachmentRefs)
        .innerJoin(conversationTurns, eq(conversationTurns.promptId, promptAttachmentRefs.promptId))
        .where(
          and(
            eq(conversationTurns.sessionId, sessionId),
            eq(promptAttachmentRefs.attachmentId, attachmentId),
          ),
        )
        .get();
      if (fromPrompt) return Promise.resolve(true);
      const fromResource = db
        .select({ id: sessionResources.attachmentId })
        .from(sessionResources)
        .where(
          and(
            eq(sessionResources.sessionId, sessionId),
            eq(sessionResources.attachmentId, attachmentId),
          ),
        )
        .get();
      return Promise.resolve(fromResource !== undefined);
    },

    commitAttachment({ attachment, blob, uploadId }: AttachmentCommit): Promise<void> {
      db.transaction((tx) => {
        tx.insert(blobs).values(blob).onConflictDoNothing().run();
        tx.insert(attachments).values(toAttachmentRow(attachment)).run();
        tx.insert(attachmentBlobs)
          .values({
            attachmentId: attachment.attachmentId,
            variant: ORIGINAL_VARIANT,
            blobId: blob.blobId,
          })
          .run();
        if (uploadId !== undefined) {
          tx.update(uploadLeases)
            .set({ blobId: blob.blobId, attachmentId: attachment.attachmentId })
            .where(eq(uploadLeases.uploadId, uploadId))
            .run();
        }
      });
      return Promise.resolve();
    },

    sweep({ graceBefore, now }: AttachmentSweepWindow): Promise<BlobId[]> {
      const doomed = db.transaction((tx) => {
        tx.delete(uploadLeases).where(lte(uploadLeases.expiresAt, now)).run();
        // NOT IN over a nullable column needs the IS NOT NULL filter: one NULL would make the
        // predicate unknown for every row and the reaper would silently collect nothing.
        tx.delete(attachments)
          .where(
            and(
              lt(attachments.createdAt, graceBefore),
              notInArray(
                attachments.attachmentId,
                tx.select({ id: promptAttachmentRefs.attachmentId }).from(promptAttachmentRefs),
              ),
              notInArray(
                attachments.attachmentId,
                tx
                  .select({ id: sessionResources.attachmentId })
                  .from(sessionResources)
                  .where(isNotNull(sessionResources.attachmentId)),
              ),
              notInArray(
                attachments.attachmentId,
                tx
                  .select({ id: uploadLeases.attachmentId })
                  .from(uploadLeases)
                  .where(isNotNull(uploadLeases.attachmentId)),
              ),
            ),
          )
          .run();
        const rows = tx
          .select({ blobId: blobs.blobId })
          .from(blobs)
          .where(
            and(
              lt(blobs.createdAt, graceBefore),
              notInArray(
                blobs.blobId,
                tx.select({ id: attachmentBlobs.blobId }).from(attachmentBlobs),
              ),
              notInArray(
                blobs.blobId,
                tx
                  .select({ id: uploadLeases.blobId })
                  .from(uploadLeases)
                  .where(isNotNull(uploadLeases.blobId)),
              ),
            ),
          )
          .all();
        const blobIds = rows.map((row) => BlobIdSchema.parse(row.blobId));
        if (blobIds.length > 0) tx.delete(blobs).where(inArray(blobs.blobId, blobIds)).run();
        return blobIds;
      });
      return Promise.resolve(doomed);
    },
  };
}

function toAttachmentRow(
  attachment: AttachmentCommit['attachment'],
): typeof attachments.$inferInsert {
  return {
    attachmentId: attachment.attachmentId,
    kind: attachment.kind,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    metadataJson: JSON.stringify(attachment.metadata),
    createdAt: attachment.createdAt,
  };
}

function toStoredAttachment(row: AttachmentRow, blobId: string): StoredAttachment {
  return {
    ...AttachmentRecordSchema.parse({
      attachmentId: row.attachmentId,
      kind: row.kind,
      name: row.name,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      metadata: JSON.parse(row.metadataJson),
      createdAt: row.createdAt,
    }),
    blobId: BlobIdSchema.parse(blobId),
  };
}

function toLeaseRow(lease: UploadLease): typeof uploadLeases.$inferInsert {
  return {
    uploadId: lease.uploadId,
    declaredSha256: lease.declaredSha256,
    declaredSize: lease.declaredSize,
    name: lease.name,
    mimeType: lease.mimeType ?? null,
    kind: lease.kind,
    blobId: lease.blobId ?? null,
    attachmentId: lease.attachmentId ?? null,
    expiresAt: lease.expiresAt,
    createdAt: lease.createdAt,
  };
}

function toLease(row: LeaseRow): UploadLease {
  return UploadLeaseSchema.parse({
    uploadId: row.uploadId,
    declaredSha256: row.declaredSha256,
    declaredSize: row.declaredSize,
    name: row.name,
    mimeType: row.mimeType ?? undefined,
    kind: row.kind,
    blobId: row.blobId ?? undefined,
    attachmentId: row.attachmentId ?? undefined,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  });
}
