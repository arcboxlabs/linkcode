import { z } from 'zod';
import {
  AttachmentKindSchema,
  AttachmentNameSchema,
  BlobIdSchema,
  MimeTypeSchema,
  Sha256HexSchema,
  UploadIdSchema,
} from '../model/attachment';
import { MAX_ATTACHMENT_BYTES } from '../model/content';
import { AttachmentIdSchema, OperationIdSchema, SessionIdSchema } from '../model/primitives';
import { WireRequestIdSchema } from './request';

/** Raw bytes per upload/read chunk. One frame stays under the tunnel's 768 KiB chunk and
 * workerd's 1 MiB cap after base64 (~341 KiB). */
export const ATTACHMENT_UPLOAD_CHUNK_BYTES = 256 * 1024;

/** Unacked chunks a client may have in flight; acks are cumulative. */
export const ATTACHMENT_UPLOAD_WINDOW_CHUNKS = 2;

/** `ATTACHMENT_UPLOAD_CHUNK_BYTES` as base64 — the per-frame `data` cap. */
export const ATTACHMENT_UPLOAD_CHUNK_BASE64_MAX = 4 * Math.ceil(ATTACHMENT_UPLOAD_CHUNK_BYTES / 3);

/** The wire version that introduced chunked attachment upload/read. Clients feature-detect on it. */
export const ATTACHMENT_STORE_WIRE_VERSION = 80 as const;

export const AttachmentUploadStateSchema = z.enum(['ready', 'exists']);
export type AttachmentUploadState = z.infer<typeof AttachmentUploadStateSchema>;

/** Chunked attachment upload and read. Bytes travel as base64; `resource.source.upload` stays for
 * older peers. Draft leases are not bound to a session — a later prompt or resource claims them. */
export const attachmentWireVariants = [
  z.object({
    kind: z.literal('attachment.upload.begin'),
    clientReqId: WireRequestIdSchema,
    /** Replay key for a lost begin reply; a second begin with the same id returns the first. */
    operationId: OperationIdSchema.optional(),
    declaredSha256: Sha256HexSchema,
    declaredSize: z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES),
    name: AttachmentNameSchema,
    mimeType: MimeTypeSchema.optional(),
    /** AttachmentRecord.kind — not the frame discriminator. */
    attachmentKind: AttachmentKindSchema,
  }),
  z.object({
    kind: z.literal('attachment.upload.begun'),
    replyTo: WireRequestIdSchema,
    uploadId: UploadIdSchema,
    chunkBytes: z.number().int().positive(),
    state: AttachmentUploadStateSchema,
  }),
  z.object({
    kind: z.literal('attachment.upload.chunk'),
    clientReqId: WireRequestIdSchema,
    uploadId: UploadIdSchema,
    offset: z.number().int().nonnegative(),
    data: z.string().max(ATTACHMENT_UPLOAD_CHUNK_BASE64_MAX),
  }),
  z.object({
    kind: z.literal('attachment.upload.chunk.acked'),
    replyTo: WireRequestIdSchema,
    uploadId: UploadIdSchema,
    /** Contiguous prefix received so far; the next chunk must start here. */
    receivedBytes: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('attachment.upload.commit'),
    clientReqId: WireRequestIdSchema,
    uploadId: UploadIdSchema,
  }),
  z.object({
    kind: z.literal('attachment.upload.committed'),
    replyTo: WireRequestIdSchema,
    attachmentId: AttachmentIdSchema,
    blobId: BlobIdSchema,
  }),
  z.object({
    kind: z.literal('attachment.upload.abort'),
    clientReqId: WireRequestIdSchema,
    uploadId: UploadIdSchema,
  }),
  z.object({
    kind: z.literal('attachment.read'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    attachmentId: AttachmentIdSchema,
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive().max(ATTACHMENT_UPLOAD_CHUNK_BYTES),
  }),
  z.object({
    kind: z.literal('attachment.read.result'),
    replyTo: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    attachmentId: AttachmentIdSchema,
    blobId: BlobIdSchema,
    offset: z.number().int().nonnegative(),
    data: z.string().max(ATTACHMENT_UPLOAD_CHUNK_BASE64_MAX),
    sizeBytes: z.number().int().nonnegative(),
    eof: z.boolean(),
  }),
] as const;
