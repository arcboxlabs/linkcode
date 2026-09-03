import { randomUUID } from 'node:crypto';
import type { AttachmentId, BlobId, SessionId, UploadId, UploadLease } from '@linkcode/schema';
import {
  ATTACHMENT_UPLOAD_CHUNK_BYTES,
  ATTACHMENT_UPLOAD_WINDOW_CHUNKS,
  AttachmentIdSchema,
  blobIdFromSha256,
  MAX_ATTACHMENT_BYTES,
  UploadIdSchema,
} from '@linkcode/schema';
import { Effect } from 'effect';
import { noop } from 'foxts/noop';
import { OperationError, RequestError } from '../failure';
import type { AttachmentStore } from './attachment-store';
import type { BlobStage, BlobStore } from './blob-store';
import { BlobIntegrityError } from './blob-store';
import { UPLOAD_LEASE_TTL_MS } from './gc';
import { AttachmentIoMutex } from './io-mutex';
import { declaredMimeTypeMatches } from './mime-sniff';

const HEAD_BYTES = 16;
const rUploadId = /^[\w-]{1,128}$/;

export interface AttachmentBeginInput {
  readonly operationId?: string;
  readonly declaredSha256: string;
  readonly declaredSize: number;
  readonly name: string;
  readonly mimeType?: string;
  readonly attachmentKind: string;
}

export interface AttachmentBeginResult {
  readonly uploadId: UploadId;
  readonly chunkBytes: number;
  readonly state: 'ready' | 'exists';
}

export interface AttachmentChunkAck {
  readonly uploadId: UploadId;
  readonly receivedBytes: number;
}

export interface AttachmentCommitResult {
  readonly attachmentId: AttachmentId;
  readonly blobId: BlobId;
}

export interface AttachmentReadResult {
  readonly sessionId: SessionId;
  readonly attachmentId: AttachmentId;
  readonly blobId: BlobId;
  readonly offset: number;
  readonly data: string;
  readonly sizeBytes: number;
  readonly eof: boolean;
}

interface LiveUpload {
  readonly lease: UploadLease;
  readonly stage: BlobStage | undefined;
  receivedBytes: number;
  head: Uint8Array;
  readonly state: 'ready' | 'exists';
}

export class AttachmentUploadService {
  private readonly live = new Map<string, LiveUpload>();
  private readonly begunByOperation = new Map<string, AttachmentBeginResult>();

  constructor(
    private readonly blobs: BlobStore,
    private readonly attachments: AttachmentStore,
    private readonly io: AttachmentIoMutex = new AttachmentIoMutex(),
    private readonly clock: () => number = Date.now,
  ) {}

  begin(
    input: AttachmentBeginInput,
  ): Effect.Effect<AttachmentBeginResult, RequestError | OperationError> {
    const store = this.store.bind(this);
    const files = this.files.bind(this);
    return Effect.gen({ self: this }, function* () {
      if (input.operationId !== undefined) {
        const replayed = this.begunByOperation.get(input.operationId);
        if (replayed) return replayed;
      }
      if (input.declaredSize > MAX_ATTACHMENT_BYTES) {
        return yield* invalid('limit_exceeded', 'Attachment exceeds the 8 MiB limit');
      }
      const uploadId = UploadIdSchema.parse(`upl-${randomUUID()}`);
      const now = this.clock();
      const lease = yield* store('begin', () =>
        this.attachments.beginUpload({
          uploadId,
          declaredSha256: input.declaredSha256,
          declaredSize: input.declaredSize,
          name: input.name,
          mimeType: input.mimeType,
          kind: input.attachmentKind,
          expiresAt: now + UPLOAD_LEASE_TTL_MS,
          createdAt: now,
        }),
      );
      const pinnedBlobId = lease.blobId;
      let state: 'ready' | 'exists' = 'ready';
      if (pinnedBlobId !== undefined) {
        const info = yield* files('stat', () => this.blobs.stat(pinnedBlobId));
        if (info?.sizeBytes === input.declaredSize) state = 'exists';
      }
      const stage =
        state === 'ready'
          ? yield* files('stage', () => this.blobs.stage(uploadId)).pipe(
              Effect.tapError(() =>
                store('begin-cleanup', () => this.attachments.deleteLease(uploadId)).pipe(
                  Effect.ignore,
                ),
              ),
            )
          : undefined;
      this.live.set(uploadId, {
        lease,
        stage,
        receivedBytes: state === 'exists' ? input.declaredSize : 0,
        head: new Uint8Array(0),
        state,
      });
      const result: AttachmentBeginResult = {
        uploadId,
        chunkBytes: ATTACHMENT_UPLOAD_CHUNK_BYTES,
        state,
      };
      if (input.operationId !== undefined) this.begunByOperation.set(input.operationId, result);
      return result;
    });
  }

  chunk(
    uploadId: UploadId,
    offset: number,
    data: string,
  ): Effect.Effect<AttachmentChunkAck, RequestError | OperationError> {
    const store = this.store.bind(this);
    const files = this.files.bind(this);
    return Effect.gen({ self: this }, function* () {
      if (!rUploadId.test(uploadId)) return yield* invalid('not_found', 'Upload not found');
      const live = this.live.get(uploadId);
      const stage = live?.stage;
      if (!live || stage === undefined) {
        const lease = yield* store('getLease', () => this.attachments.getLease(uploadId));
        if (!lease) return yield* invalid('not_found', 'Upload not found');
        if (live?.state === 'exists' || lease.blobId !== undefined) {
          return yield* invalid('invalid_request', 'Blob already stored; commit without chunks');
        }
        return yield* invalid('conflict', 'Upload is not accepting chunks; retry from begin');
      }
      if (offset !== live.receivedBytes) {
        return yield* invalid(
          'invalid_request',
          `Expected offset ${live.receivedBytes}, got ${offset}`,
        );
      }
      const windowEnd =
        live.receivedBytes + ATTACHMENT_UPLOAD_WINDOW_CHUNKS * ATTACHMENT_UPLOAD_CHUNK_BYTES;
      if (offset >= windowEnd && live.receivedBytes < live.lease.declaredSize) {
        return yield* invalid('invalid_request', 'Chunk is outside the credit window');
      }
      const bytes = yield* Effect.try({
        try: () => decodeChunk(data),
        catch: (cause) => mapCause(cause, 'store', 'chunk'),
      });
      if (live.receivedBytes + bytes.byteLength > live.lease.declaredSize) {
        return yield* invalid('invalid_request', 'Chunk exceeds the declared size');
      }
      yield* files('write', () => stage.write(offset, bytes));
      if (offset === 0) live.head = bytes.subarray(0, Math.min(HEAD_BYTES, bytes.byteLength));
      live.receivedBytes += bytes.byteLength;
      return { uploadId, receivedBytes: live.receivedBytes };
    });
  }

  commit(uploadId: UploadId): Effect.Effect<AttachmentCommitResult, RequestError | OperationError> {
    const store = this.store.bind(this);
    const files = this.files.bind(this);
    const forget = this.forget.bind(this);
    const publishExists = this.publishExists.bind(this);
    const publishReady = this.publishReady.bind(this);
    return Effect.gen({ self: this }, function* () {
      if (!rUploadId.test(uploadId)) return yield* invalid('not_found', 'Upload not found');
      const live = this.live.get(uploadId);
      const lease =
        live?.lease ?? (yield* store('getLease', () => this.attachments.getLease(uploadId)));
      if (!lease) return yield* invalid('not_found', 'Upload not found');
      if (lease.attachmentId !== undefined && lease.blobId !== undefined) {
        forget(uploadId);
        return { attachmentId: lease.attachmentId, blobId: lease.blobId };
      }
      const pinnedBlobId = lease.blobId;
      const existsFile =
        pinnedBlobId === undefined
          ? undefined
          : yield* files('stat', () => this.blobs.stat(pinnedBlobId));
      const exists = live?.state === 'exists' || existsFile !== undefined;
      if (exists) {
        const blobId = pinnedBlobId ?? blobIdFromSha256(lease.declaredSha256);
        const head =
          (yield* files('read', () => this.blobs.read(blobId, 0, HEAD_BYTES))) ?? new Uint8Array(0);
        yield* assertMime(lease.mimeType, head);
        const committed = yield* publishExists(lease, blobId);
        forget(uploadId);
        return committed;
      }
      if (!live?.stage) {
        return yield* invalid('conflict', 'Upload is not accepting commit; retry from begin');
      }
      if (live.receivedBytes !== lease.declaredSize) {
        return yield* invalid(
          'invalid_request',
          `Uploaded ${live.receivedBytes} bytes, declared ${lease.declaredSize}`,
        );
      }
      yield* assertMime(lease.mimeType, live.head);
      const committed = yield* publishReady(live);
      forget(uploadId);
      return committed;
    });
  }

  abort(uploadId: UploadId): Effect.Effect<void, RequestError | OperationError> {
    const store = this.store.bind(this);
    const files = this.files.bind(this);
    const forget = this.forget.bind(this);
    return Effect.gen({ self: this }, function* () {
      if (!rUploadId.test(uploadId)) return yield* invalid('not_found', 'Upload not found');
      const live = this.live.get(uploadId);
      const stage = live?.stage;
      if (stage) {
        yield* files('abort', () => stage.abort());
      } else {
        const lease = yield* store('getLease', () => this.attachments.getLease(uploadId));
        if (!lease && !live) return yield* invalid('not_found', 'Upload not found');
      }
      yield* store('deleteLease', () => this.attachments.deleteLease(uploadId));
      forget(uploadId);
    });
  }

  read(
    sessionId: SessionId,
    attachmentId: AttachmentId,
    offset: number,
    length: number,
  ): Effect.Effect<AttachmentReadResult, RequestError | OperationError> {
    const store = this.store.bind(this);
    const files = this.files.bind(this);
    return Effect.gen({ self: this }, function* () {
      const reachable = yield* store('isReachable', () =>
        this.attachments.isReachable(sessionId, attachmentId),
      );
      if (!reachable) return yield* invalid('not_found', 'Attachment not found');
      const attachment = yield* store('getAttachment', () =>
        this.attachments.getAttachment(attachmentId),
      );
      if (!attachment) return yield* invalid('not_found', 'Attachment not found');
      if (offset > attachment.sizeBytes) {
        return yield* invalid('invalid_request', 'Read offset is past the end of the attachment');
      }
      const bytes =
        (yield* files('read', () => this.blobs.read(attachment.blobId, offset, length))) ??
        undefined;
      if (bytes === undefined) return yield* invalid('not_found', 'Attachment bytes are missing');
      const end = offset + bytes.byteLength;
      return {
        sessionId,
        attachmentId,
        blobId: attachment.blobId,
        offset,
        data: Buffer.from(bytes).toString('base64'),
        sizeBytes: attachment.sizeBytes,
        eof: end >= attachment.sizeBytes,
      };
    });
  }

  private publishExists(
    lease: UploadLease,
    blobId: BlobId,
  ): Effect.Effect<AttachmentCommitResult, RequestError | OperationError> {
    const { attachments, clock, io } = this;
    const attachmentId = AttachmentIdSchema.parse(`att-${randomUUID()}`);
    const now = clock();
    return this.files('commit', async () => {
      await io.run(async () => {
        await attachments.commitAttachment({
          blob: { blobId, sizeBytes: lease.declaredSize, createdAt: now },
          attachment: recordFromLease(lease, attachmentId, now),
          uploadId: lease.uploadId,
        });
      });
      return { attachmentId, blobId };
    });
  }

  private publishReady(
    live: LiveUpload,
  ): Effect.Effect<AttachmentCommitResult, RequestError | OperationError> {
    const { attachments, blobs, clock, io } = this;
    const { lease, stage } = live;
    if (!stage) {
      return invalid('conflict', 'Upload is not accepting commit; retry from begin');
    }
    const attachmentId = AttachmentIdSchema.parse(`att-${randomUUID()}`);
    const now = clock();
    const expected = { sha256: lease.declaredSha256, sizeBytes: lease.declaredSize };
    return this.files('commit', async () => {
      let blobId: BlobId | undefined;
      await io.run(async () => {
        try {
          blobId = await stage.commit(expected);
          await attachments.commitAttachment({
            blob: { blobId, sizeBytes: lease.declaredSize, createdAt: now },
            attachment: recordFromLease(lease, attachmentId, now),
            uploadId: lease.uploadId,
          });
        } catch (error) {
          await stage.abort().catch(noop);
          if (blobId) await blobs.delete(blobId);
          throw error;
        }
      });
      if (!blobId) throw new Error('Attachment commit produced no blob id');
      return { attachmentId, blobId };
    });
  }

  private forget(uploadId: UploadId): void {
    this.live.delete(uploadId);
    for (const [operationId, begun] of this.begunByOperation) {
      if (begun.uploadId === uploadId) this.begunByOperation.delete(operationId);
    }
  }

  private store<A>(
    operation: string,
    work: () => Promise<A>,
  ): Effect.Effect<A, OperationError | RequestError> {
    return Effect.tryPromise({
      try: async () => work(),
      catch: (cause) => mapCause(cause, 'store', operation),
    });
  }

  private files<A>(
    operation: string,
    work: () => Promise<A>,
  ): Effect.Effect<A, OperationError | RequestError> {
    return Effect.tryPromise({
      try: async () => work(),
      catch: (cause) => mapCause(cause, 'filesystem', operation),
    });
  }
}

function recordFromLease(lease: UploadLease, attachmentId: AttachmentId, now: number) {
  return {
    attachmentId,
    kind: lease.kind,
    name: lease.name,
    mimeType: lease.mimeType ?? 'application/octet-stream',
    sizeBytes: lease.declaredSize,
    metadata: {},
    createdAt: now,
  };
}

function decodeChunk(data: string): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);
  const bytes = Buffer.from(data, 'base64');
  if (bytes.byteLength === 0) {
    throw new RequestError({ code: 'invalid_request', message: 'Chunk data is not valid base64' });
  }
  if (bytes.byteLength > ATTACHMENT_UPLOAD_CHUNK_BYTES) {
    throw new RequestError({
      code: 'invalid_request',
      message: 'Chunk exceeds the negotiated size',
    });
  }
  return bytes;
}

function assertMime(
  mimeType: string | undefined,
  head: Uint8Array,
): Effect.Effect<void, RequestError> {
  const declared = mimeType ?? 'application/octet-stream';
  if (!declaredMimeTypeMatches(declared, head)) {
    return invalid('invalid_request', `File contents are not ${declared}`);
  }
  return Effect.void;
}

function invalid(
  code: 'invalid_request' | 'limit_exceeded' | 'not_found' | 'conflict',
  message: string,
): Effect.Effect<never, RequestError> {
  return Effect.fail(new RequestError({ code, message }));
}

function mapCause(
  cause: unknown,
  subsystem: 'store' | 'filesystem',
  operation: string,
): RequestError | OperationError {
  if (cause instanceof RequestError) return cause;
  if (cause instanceof BlobIntegrityError) {
    return new RequestError({ code: 'invalid_request', message: cause.message });
  }
  return new OperationError({
    subsystem,
    operation: `attachments.${operation}`,
    publicMessage: 'Attachment operation failed',
    cause,
  });
}
