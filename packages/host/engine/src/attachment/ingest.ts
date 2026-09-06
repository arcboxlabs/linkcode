import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import type { AttachmentId, ContentBlock, PromptBlock } from '@linkcode/schema';
import { AttachmentIdSchema, blobIdFromSha256, MAX_ATTACHMENT_NAME_LENGTH } from '@linkcode/schema';
import { Effect } from 'effect';
import { noop } from 'foxts/noop';
import { OperationError } from '../failure';
import type { AttachmentStore } from './attachment-store';
import type { BlobStore } from './blob-store';
import type { AttachmentIoMutex } from './io-mutex';

export interface IngestRecord {
  readonly kind: string;
  readonly name: string;
  readonly mimeType: string;
}

/** Bytes the daemon already holds (a resource upload, a legacy inline image) become one stored
 * attachment. Publish and row insert share the GC mutex so a doomed blob cannot regrow a row. */
export class AttachmentIngest {
  constructor(
    private readonly blobs: BlobStore,
    private readonly attachments: AttachmentStore,
    private readonly io: AttachmentIoMutex,
  ) {}

  store(bytes: Uint8Array, record: IngestRecord, now = Date.now()): Promise<AttachmentId> {
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const blobId = blobIdFromSha256(sha256);
    const attachmentId = AttachmentIdSchema.parse(`att-${randomUUID()}`);
    const { attachments, blobs } = this;
    return this.io.run(async () => {
      const stage = await blobs.stage(attachmentId);
      try {
        await stage.write(0, bytes);
        await stage.commit({ sha256, sizeBytes: bytes.byteLength });
        await attachments.commitAttachment({
          blob: { blobId, sizeBytes: bytes.byteLength, createdAt: now },
          attachment: {
            attachmentId,
            ...record,
            sizeBytes: bytes.byteLength,
            metadata: {},
            createdAt: now,
          },
        });
      } catch (error) {
        await stage.abort().catch(noop);
        // Content addressing means another attachment may already own a row for this blob;
        // unlinking then would strand its bytes.
        if (!(await attachments.getBlob(blobId))) await blobs.delete(blobId);
        throw error;
      }
      return attachmentId;
    });
  }

  /** Durable blocks for legacy prompt content: inline images are stored and referenced, so the
   * row keeps them after the live echo is gone. Other binary blocks were refused at admit. */
  promptBlocks(content: readonly ContentBlock[]): Effect.Effect<PromptBlock[], OperationError> {
    return Effect.tryPromise({
      try: () =>
        Promise.all(
          content.map(async (block): Promise<PromptBlock | undefined> => {
            if (block.type === 'text') return { type: 'text', text: block.text };
            if (block.type !== 'image') return;
            // The legacy block's name is unbounded; the record's is not.
            const attachmentId = await this.store(Buffer.from(block.data, 'base64'), {
              kind: 'image',
              name: (block.name || 'image').slice(0, MAX_ATTACHMENT_NAME_LENGTH),
              mimeType: block.mimeType,
            });
            return { type: 'attachment_ref', attachmentId };
          }),
        ).then((blocks) => blocks.filter((block) => block !== undefined)),
      catch: (cause) =>
        new OperationError({
          subsystem: 'filesystem',
          operation: 'attachments.ingest',
          publicMessage: 'Failed to store a prompt attachment',
          cause,
        }),
    });
  }
}
