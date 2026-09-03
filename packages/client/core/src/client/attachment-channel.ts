import type { AttachmentId, OperationId, SessionId, UploadId } from '@linkcode/schema';
import { ATTACHMENT_UPLOAD_CHUNK_BYTES, ATTACHMENT_UPLOAD_WINDOW_CHUNKS } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { AttachmentBlobCache, base64ToBytes, bytesToBase64, sha256Hex } from './blob-cache';
import type {
  AttachmentChunkAck,
  AttachmentCommitResult,
  AttachmentReadResult,
  AttachmentUploadBegun,
  PendingRegistry,
} from './pending-registry';
import { sendCorrelated } from './pending-registry';

export interface AttachmentBeginInput {
  readonly declaredSha256: string;
  readonly declaredSize: number;
  readonly name: string;
  readonly mimeType?: string;
  readonly attachmentKind: string;
  readonly operationId?: OperationId;
}

export interface AttachmentPutInput {
  readonly bytes: Uint8Array;
  readonly name: string;
  readonly mimeType?: string;
  readonly attachmentKind: string;
  readonly operationId?: OperationId;
}

/**
 * Chunked attachment upload/read. Credit-windowed puts retry from zero; completed re-sends are
 * free via the daemon's SHA-256 short-circuit. The cache is keyed by `blobId`.
 */
export class AttachmentChannel {
  readonly cache = new AttachmentBlobCache();

  constructor(
    private readonly transport: Transport,
    private readonly pending: PendingRegistry,
  ) {}

  beginUpload(input: AttachmentBeginInput): Promise<AttachmentUploadBegun> {
    return sendCorrelated(this.transport, this.pending, 'attachmentBegin', (clientReqId) => ({
      kind: 'attachment.upload.begin',
      clientReqId,
      declaredSha256: input.declaredSha256,
      declaredSize: input.declaredSize,
      name: input.name,
      mimeType: input.mimeType,
      attachmentKind: input.attachmentKind,
      operationId: input.operationId,
    }));
  }

  sendChunk(uploadId: UploadId, offset: number, data: string): Promise<AttachmentChunkAck> {
    return sendCorrelated(this.transport, this.pending, 'attachmentChunk', (clientReqId) => ({
      kind: 'attachment.upload.chunk',
      clientReqId,
      uploadId,
      offset,
      data,
    }));
  }

  commit(uploadId: UploadId): Promise<AttachmentCommitResult> {
    return sendCorrelated(this.transport, this.pending, 'attachmentCommit', (clientReqId) => ({
      kind: 'attachment.upload.commit',
      clientReqId,
      uploadId,
    }));
  }

  abort(uploadId: UploadId): Promise<{ ok: true }> {
    return sendCorrelated(this.transport, this.pending, 'ack', (clientReqId) => ({
      kind: 'attachment.upload.abort',
      clientReqId,
      uploadId,
    }));
  }

  read(
    sessionId: SessionId,
    attachmentId: AttachmentId,
    offset: number,
    length: number,
  ): Promise<AttachmentReadResult> {
    return sendCorrelated(this.transport, this.pending, 'attachmentRead', (clientReqId) => ({
      kind: 'attachment.read',
      clientReqId,
      sessionId,
      attachmentId,
      offset,
      length,
    }));
  }

  /** Hash, begin, windowed chunks, commit. Identical bytes short-circuit to `exists`. */
  async put(input: AttachmentPutInput): Promise<AttachmentCommitResult> {
    const declaredSha256 = await sha256Hex(input.bytes);
    const begun = await this.beginUpload({
      declaredSha256,
      declaredSize: input.bytes.byteLength,
      name: input.name,
      mimeType: input.mimeType,
      attachmentKind: input.attachmentKind,
      operationId: input.operationId,
    });
    if (begun.state === 'ready') {
      await this.sendWindowed(begun.uploadId, begun.chunkBytes, input.bytes);
    }
    const committed = await this.commit(begun.uploadId);
    this.cache.set(committed.blobId, input.bytes);
    return committed;
  }

  /** Assemble the attachment through `attachment.read`, using the cache when the blob is known. */
  async get(sessionId: SessionId, attachmentId: AttachmentId): Promise<AttachmentReadBytes> {
    const first = await this.read(sessionId, attachmentId, 0, ATTACHMENT_UPLOAD_CHUNK_BYTES);
    const cached = this.cache.get(first.blobId);
    if (cached?.byteLength === first.sizeBytes) {
      return { blobId: first.blobId, bytes: cached, sizeBytes: first.sizeBytes };
    }
    const bytes = new Uint8Array(first.sizeBytes);
    const firstSlice = base64ToBytes(first.data);
    bytes.set(firstSlice, first.offset);
    let offset = first.offset + firstSlice.byteLength;
    while (offset < first.sizeBytes) {
      // eslint-disable-next-line no-await-in-loop -- sequential pages of one attachment
      const page = await this.read(sessionId, attachmentId, offset, ATTACHMENT_UPLOAD_CHUNK_BYTES);
      const slice = base64ToBytes(page.data);
      bytes.set(slice, page.offset);
      offset = page.offset + slice.byteLength;
      if (page.eof) break;
    }
    this.cache.set(first.blobId, bytes);
    return { blobId: first.blobId, bytes, sizeBytes: first.sizeBytes };
  }

  private async sendWindowed(
    uploadId: UploadId,
    chunkBytes: number,
    bytes: Uint8Array,
  ): Promise<void> {
    const acks: Array<Promise<void>> = [];
    let offset = 0;
    while (offset < bytes.byteLength) {
      const inflight = acks.length;
      if (inflight >= ATTACHMENT_UPLOAD_WINDOW_CHUNKS) {
        // eslint-disable-next-line no-await-in-loop -- credit window drains the oldest ack
        await acks[inflight - ATTACHMENT_UPLOAD_WINDOW_CHUNKS];
      }
      const end = Math.min(offset + chunkBytes, bytes.byteLength);
      const at = offset;
      const data = bytesToBase64(bytes.subarray(at, end));
      offset = end;
      acks.push(this.sendChunk(uploadId, at, data).then(noop));
    }
    for (let i = 0, len = acks.length; i < len; i++) {
      // eslint-disable-next-line no-await-in-loop -- drain remaining acks
      await acks[i];
    }
  }
}

export interface AttachmentReadBytes {
  readonly blobId: string;
  readonly bytes: Uint8Array;
  readonly sizeBytes: number;
}
