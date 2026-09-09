import { Buffer } from 'node:buffer';
import { chmod, link, mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  AttachmentCapability,
  ContentBlock,
  PromptRecord,
  RunId,
  SessionId,
} from '@linkcode/schema';
import { Effect } from 'effect';
import { OperationError, RequestError } from '../failure';
import { admitPromptAttachments, attachmentIdsFromBlocks, uniqueAttachmentIds } from './admit';
import type { AttachmentStore, StoredAttachment } from './attachment-store';
import type { BlobStore } from './blob-store';
import { AttachmentIoMutex } from './io-mutex';

const rPathSep = /[/\\]/g;
const rUnsafePathSegment = /[/\\]|\.\./;

export type PreparedAttachment =
  | {
      readonly type: 'inline_image';
      readonly attachment: StoredAttachment;
      readonly block: Extract<ContentBlock, { type: 'image' }>;
    }
  | {
      readonly type: 'readonly_file';
      readonly attachment: StoredAttachment;
      readonly path: string;
    };

export interface PreparedPrompt {
  readonly blocks: Array<{ readonly type: 'text'; readonly text: string } | PreparedAttachment>;
}

/**
 * Last hop before the adapter: the only place attachment bytes leave the store.
 * Path materialization assumes the harness shares this filesystem — that assumption stays here.
 */
export class PromptMaterializer {
  constructor(
    private readonly attachments: AttachmentStore,
    private readonly blobs: BlobStore,
    private readonly stateDir: string,
    private readonly io: AttachmentIoMutex = new AttachmentIoMutex(),
  ) {}

  prepare(
    sessionId: SessionId,
    runId: RunId,
    prompt: PromptRecord,
    capability: AttachmentCapability | undefined,
  ): Effect.Effect<PreparedPrompt, RequestError | OperationError> {
    const load = this.loadStored.bind(this);
    const convert = this.convert.bind(this);
    return Effect.gen(function* () {
      const ids = uniqueAttachmentIds(attachmentIdsFromBlocks(prompt.blocks));
      const stored = yield* load(ids);
      yield* Effect.try({
        try() {
          admitPromptAttachments(prompt.blocks, stored, capability);
        },
        catch(error) {
          return error instanceof RequestError
            ? error
            : new OperationError({
                subsystem: 'store',
                operation: 'attachments.admit',
                publicMessage: 'Attachment validation failed',
                cause: error,
              });
        },
      });
      const byId = new Map(stored.map((attachment) => [attachment.attachmentId, attachment]));
      const blocks: PreparedPrompt['blocks'] = [];
      for (let i = 0, len = prompt.blocks.length; i < len; i++) {
        const block = prompt.blocks[i];
        if (block.type === 'text') {
          blocks.push(block);
          continue;
        }
        const attachment = byId.get(block.attachmentId);
        if (attachment === undefined) {
          return yield* Effect.fail(
            new RequestError({
              code: 'unsupported_attachment',
              message: 'Unknown attachment',
            }),
          );
        }
        blocks.push(yield* convert(sessionId, runId, attachment, capability));
      }
      return { blocks };
    });
  }

  toContentBlocks(prepared: PreparedPrompt): ContentBlock[] {
    const content: ContentBlock[] = [];
    for (let i = 0, len = prepared.blocks.length; i < len; i++) {
      const block = prepared.blocks[i];
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text });
        continue;
      }
      if (block.type === 'inline_image') {
        content.push(block.block);
        continue;
      }
      // A file projection reaches the harness as the link the inline guard admits for
      // `readonly_file`: the materialized path, never the store's bytes.
      content.push({
        type: 'resource_link',
        uri: pathToFileURL(block.path).href,
        name: block.attachment.name,
        mimeType: block.attachment.mimeType,
        size: block.attachment.sizeBytes,
      });
    }
    return content;
  }

  cleanupRun(sessionId: SessionId, runId: RunId): Promise<void> {
    const dir = this.runDir(sessionId, runId);
    if (dir === undefined) return Promise.resolve();
    return this.io.run(() => rm(dir, { recursive: true, force: true }));
  }

  cleanupSession(sessionId: SessionId): Promise<void> {
    const session = pathSegment(sessionId);
    if (session === undefined) return Promise.resolve();
    return this.io.run(() =>
      rm(join(this.stateDir, 'materialized', session), { recursive: true, force: true }),
    );
  }

  bootSweep(): Promise<void> {
    return this.io.run(() =>
      rm(join(this.stateDir, 'materialized'), { recursive: true, force: true }),
    );
  }

  private runDir(sessionId: SessionId, runId: RunId): string | undefined {
    const session = pathSegment(sessionId);
    const run = pathSegment(runId);
    if (session === undefined || run === undefined) return;
    return join(this.stateDir, 'materialized', session, run);
  }

  private loadStored(
    ids: ReadonlyArray<StoredAttachment['attachmentId']>,
  ): Effect.Effect<StoredAttachment[], OperationError> {
    if (ids.length === 0) return Effect.succeed([]);
    return Effect.tryPromise({
      try: () => this.attachments.listAttachments(ids),
      catch: (cause) =>
        new OperationError({
          subsystem: 'store',
          operation: 'attachments.list',
          publicMessage: 'Failed to load attachments',
          cause,
        }),
    });
  }

  private convert(
    sessionId: SessionId,
    runId: RunId,
    attachment: StoredAttachment,
    capability: AttachmentCapability | undefined,
  ): Effect.Effect<PreparedAttachment, RequestError | OperationError> {
    const representations = capability?.representations ?? [];
    if (attachment.kind === 'image' && representations.includes('inline_image')) {
      return this.inlineImage(attachment);
    }
    if (representations.includes('readonly_file')) {
      return this.readonlyFile(sessionId, runId, attachment);
    }
    return Effect.fail(
      new RequestError({
        code: 'unsupported_attachment',
        message: `This harness does not accept ${attachment.kind} attachments`,
      }),
    );
  }

  private inlineImage(
    attachment: StoredAttachment,
  ): Effect.Effect<PreparedAttachment, RequestError | OperationError> {
    const { blobs } = this;
    return Effect.tryPromise({
      async try() {
        const bytes = await blobs.read(attachment.blobId, 0, attachment.sizeBytes);
        if (bytes?.byteLength !== attachment.sizeBytes) {
          throw new RequestError({
            code: 'unsupported_attachment',
            message: 'Attachment is not ready',
          });
        }
        return {
          type: 'inline_image' as const,
          attachment,
          block: {
            type: 'image' as const,
            data: Buffer.from(bytes).toString('base64'),
            mimeType: attachment.mimeType,
            name: attachment.name,
          },
        };
      },
      catch(cause) {
        return cause instanceof RequestError
          ? cause
          : new OperationError({
              subsystem: 'filesystem',
              operation: 'attachments.materialize',
              publicMessage: 'Failed to read attachment bytes',
              cause,
            });
      },
    });
  }

  private readonlyFile(
    sessionId: SessionId,
    runId: RunId,
    attachment: StoredAttachment,
  ): Effect.Effect<PreparedAttachment, RequestError | OperationError> {
    const destDir = this.runDir(sessionId, runId);
    if (destDir === undefined) {
      return Effect.fail(
        new RequestError({
          code: 'unsupported_attachment',
          message: 'Failed to materialize attachment file',
        }),
      );
    }
    const dest = join(destDir, destName(attachment));
    const source = this.blobs.pathOf(attachment.blobId);
    const { io } = this;
    return Effect.tryPromise({
      try() {
        return io.run(async () => {
          await mkdir(destDir, { recursive: true });
          // The destination is keyed by the immutable attachment id, so an existing link is already
          // the same bytes — a prompt may reference one attachment more than once within a run.
          await link(source, dest).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'EEXIST') throw error;
          });
          await chmod(dest, 0o444);
          return {
            type: 'readonly_file' as const,
            attachment,
            path: dest,
          };
        });
      },
      catch(cause) {
        return new OperationError({
          subsystem: 'filesystem',
          operation: 'attachments.materialize',
          publicMessage: 'Failed to materialize attachment file',
          cause,
        });
      },
    });
  }
}

function destName(attachment: StoredAttachment): string {
  return `${attachment.attachmentId}-${basename(attachment.name).replaceAll(rPathSep, '_')}`;
}

function pathSegment(id: string): string | undefined {
  if (id === '.' || id === '..' || rUnsafePathSegment.test(id)) return;
  return id;
}
