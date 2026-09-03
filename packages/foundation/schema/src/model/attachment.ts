import { z } from 'zod';
import { MAX_ATTACHMENT_BYTES, SUPPORTED_ATTACHMENT_IMAGE_MIME_TYPES } from './content';
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

/** Adapter-declared per-kind limits. Host ∩ adapter (∩ model, when known) is the effective cap. */
export const AttachmentKindLimitsSchema = z.object({
  mimeTypes: z.array(z.string().min(1)).min(1),
  maxBytes: z.number().int().positive(),
  maxCount: z.number().int().positive(),
});
export type AttachmentKindLimits = z.infer<typeof AttachmentKindLimitsSchema>;

/** How the engine hands bytes to a harness. `extracted_text` is later. */
export const AttachmentRepresentationSchema = z.enum(['inline_image', 'readonly_file']);
export type AttachmentRepresentation = z.infer<typeof AttachmentRepresentationSchema>;

export const AttachmentCapabilitySchema = z.object({
  kinds: z.object({
    image: AttachmentKindLimitsSchema.optional(),
    file: AttachmentKindLimitsSchema.optional(),
  }),
  representations: z.array(AttachmentRepresentationSchema).min(1),
});
export type AttachmentCapability = z.infer<typeof AttachmentCapabilitySchema>;

/** Adapter-declared image count; the 12 MiB prompt aggregate is the tighter bound for large files. */
export const DEFAULT_ATTACHMENT_IMAGE_MAX_COUNT = 16;

/** What the host can materialize. Effective capability is this ∩ the adapter declaration. */
export const HOST_ATTACHMENT_LIMITS: AttachmentCapability = {
  kinds: {
    image: {
      mimeTypes: [...SUPPORTED_ATTACHMENT_IMAGE_MIME_TYPES],
      maxBytes: MAX_ATTACHMENT_BYTES,
      maxCount: DEFAULT_ATTACHMENT_IMAGE_MAX_COUNT,
    },
  },
  representations: ['inline_image', 'readonly_file'],
};

function intersectKindLimits(
  declared: AttachmentKindLimits | undefined,
  host: AttachmentKindLimits | undefined,
): AttachmentKindLimits | undefined {
  if (declared === undefined || host === undefined) return undefined;
  const mimeTypes: string[] = [];
  for (let i = 0, len = declared.mimeTypes.length; i < len; i++) {
    const mimeType = declared.mimeTypes[i];
    if (host.mimeTypes.includes(mimeType)) mimeTypes.push(mimeType);
  }
  if (mimeTypes.length === 0) return undefined;
  return {
    mimeTypes,
    maxBytes: Math.min(declared.maxBytes, host.maxBytes),
    maxCount: Math.min(declared.maxCount, host.maxCount),
  };
}

/** Absent declaration or empty intersection means the harness accepts no attachments. */
export function intersectAttachmentCapability(
  declared: AttachmentCapability | undefined,
  host: AttachmentCapability = HOST_ATTACHMENT_LIMITS,
): AttachmentCapability | undefined {
  if (declared === undefined) return undefined;
  const representations: AttachmentRepresentation[] = [];
  for (let i = 0, len = declared.representations.length; i < len; i++) {
    const representation = declared.representations[i];
    if (host.representations.includes(representation)) representations.push(representation);
  }
  if (representations.length === 0) return undefined;
  const image = intersectKindLimits(declared.kinds.image, host.kinds.image);
  const file = intersectKindLimits(declared.kinds.file, host.kinds.file);
  if (image === undefined && file === undefined) return undefined;
  return {
    kinds: {
      ...(image !== undefined && { image }),
      ...(file !== undefined && { file }),
    },
    representations,
  };
}

/** Locator a conversation.read user row uses so clients can `attachment.read` without bytes. */
export const ATTACHMENT_URI_SCHEME = 'attachment:';

export function attachmentUri(attachmentId: string): string {
  return `${ATTACHMENT_URI_SCHEME}${attachmentId}`;
}

export function attachmentIdFromUri(uri: string): string | undefined {
  if (!uri.startsWith(ATTACHMENT_URI_SCHEME)) return undefined;
  const id = uri.slice(ATTACHMENT_URI_SCHEME.length);
  return id.length > 0 ? id : undefined;
}
