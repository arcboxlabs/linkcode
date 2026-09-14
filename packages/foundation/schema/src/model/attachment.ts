import { z } from 'zod';
import { AttachmentIdSchema, TimestampSchema } from './primitives';

/**
 * The immutable attachment store: prompts and session resources reference `AttachmentRecord`s,
 * whose bytes live in a content-addressed blob store keyed by their own SHA-256. Records and
 * reference edges are rows; bytes never are.
 */

const rSha256Hex = /^[0-9a-f]{64}$/;

/** Lowercase hex SHA-256 digest of a blob's bytes. */
export const Sha256HexSchema = z.string().regex(rSha256Hex);

/** Content address: `sha256:<hex>`. The storage path is derived from it, never stored or exposed. */
export const BlobIdSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/)
  .brand<'BlobId'>();
export type BlobId = z.infer<typeof BlobIdSchema>;

export function blobIdFromSha256(hex: string): BlobId {
  return BlobIdSchema.parse(`sha256:${hex.toLowerCase()}`);
}

const rUploadId = /^[\w-]{1,128}$/;

/** Upload ID: daemon-minted identity of one in-flight upload lease. The charset is the staging
 * filename — anything else is a path traversal. */
export const UploadIdSchema = z.string().regex(rUploadId).brand<'UploadId'>();
export type UploadId = z.infer<typeof UploadIdSchema>;

export const BlobRecordSchema = z.object({
  blobId: BlobIdSchema,
  sizeBytes: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
});
export type BlobRecord = z.infer<typeof BlobRecordSchema>;

/** Open string on purpose: a client without a renderer for a kind shows a generic card. */
export const AttachmentKindSchema = z.string().min(1).max(32);

export const MAX_ATTACHMENT_METADATA_BYTES = 4096;

/** Business identity of one attachment; many records may share one blob. */
export const AttachmentRecordSchema = z.object({
  attachmentId: AttachmentIdSchema,
  kind: AttachmentKindSchema,
  name: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  metadata: z
    .record(z.string(), z.unknown())
    .refine((value) => JSON.stringify(value).length <= MAX_ATTACHMENT_METADATA_BYTES, {
      message: `Attachment metadata exceeds ${MAX_ATTACHMENT_METADATA_BYTES} bytes`,
    }),
  createdAt: TimestampSchema,
});
export type AttachmentRecord = z.infer<typeof AttachmentRecordSchema>;

/** Which blob holds which representation of an attachment; `original` is the only variant today. */
export const AttachmentBlobSchema = z.object({
  attachmentId: AttachmentIdSchema,
  variant: z.string().min(1).max(32),
  blobId: BlobIdSchema,
});
export type AttachmentBlob = z.infer<typeof AttachmentBlobSchema>;

/**
 * An in-flight or committed-but-unclaimed upload. The lease is a GC root: it pins `blobId` once
 * the declared hash is known to exist, and `attachmentId` once committed, until a prompt or
 * session resource references the attachment (the claim) or the lease expires (the reaper).
 */
export const UploadLeaseSchema = z.object({
  uploadId: UploadIdSchema,
  declaredSha256: Sha256HexSchema,
  declaredSize: z.number().int().nonnegative(),
  name: z.string().min(1),
  mimeType: z.string().min(1).optional(),
  kind: AttachmentKindSchema,
  blobId: BlobIdSchema.optional(),
  attachmentId: AttachmentIdSchema.optional(),
  expiresAt: TimestampSchema,
  createdAt: TimestampSchema,
});
export type UploadLease = z.infer<typeof UploadLeaseSchema>;
