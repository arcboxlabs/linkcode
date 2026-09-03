import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AttachmentCapability, PromptRecord } from '@linkcode/schema';
import {
  AttachmentIdSchema,
  blobIdFromSha256,
  effectiveAttachmentCapability,
  MAX_ATTACHMENT_BYTES,
  PromptIdSchema,
  RunIdSchema,
  SessionIdSchema,
} from '@linkcode/schema';
import { Effect } from 'effect';
import { nullthrow } from 'foxts/guard';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryAttachmentStore } from '../attachment/attachment-store';
import { FsBlobStore } from '../attachment/blob-store';
import { PromptMaterializer } from '../attachment/materializer';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fixture(bytes: Uint8Array = PNG_1X1): Promise<{
  materializer: PromptMaterializer;
  store: InMemoryAttachmentStore;
  blobs: FsBlobStore;
  prompt: PromptRecord;
  capability: AttachmentCapability;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'linkcode-materializer-'));
  temporaryDirectories.push(root);
  const blobs = new FsBlobStore(join(root, 'blobs'));
  const store = new InMemoryAttachmentStore();
  const digest = sha256(bytes);
  const blobId = blobIdFromSha256(digest);
  const stage = await blobs.stage('up-1');
  await stage.write(0, bytes);
  await stage.commit({ sha256: digest, sizeBytes: bytes.byteLength });
  const attachmentId = AttachmentIdSchema.parse('att-1');
  await store.commitAttachment({
    blob: { blobId, sizeBytes: bytes.byteLength, createdAt: 1 },
    attachment: {
      attachmentId,
      kind: 'image',
      name: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: bytes.byteLength,
      metadata: {},
      createdAt: 1,
    },
  });
  const prompt: PromptRecord = {
    promptId: PromptIdSchema.parse('prompt-1'),
    blocks: [
      { type: 'text', text: 'see' },
      { type: 'attachment_ref', attachmentId },
    ],
    contextAttachmentIds: [],
    createdAt: 1,
  };
  const capability = nullthrow(
    effectiveAttachmentCapability('claude-code'),
    'claude-code must declare images',
  );
  return {
    materializer: new PromptMaterializer(store, blobs, root),
    store,
    blobs,
    prompt,
    capability,
    root,
  };
}

describe('PromptMaterializer', () => {
  it('turns a ready image ref into the same base64 ContentBlock adapters already consume', async () => {
    const { materializer, prompt, capability } = await fixture();
    const prepared = await Effect.runPromise(
      materializer.prepare(
        SessionIdSchema.parse('sess-1'),
        RunIdSchema.parse('run-1'),
        prompt,
        capability,
      ),
    );
    expect(materializer.toContentBlocks(prepared)).toEqual([
      { type: 'text', text: 'see' },
      {
        type: 'image',
        data: PNG_1X1.toString('base64'),
        mimeType: 'image/png',
        name: 'shot.png',
      },
    ]);
  });

  it('hardlinks a readonly_file projection at mode 0444 and sweeps it', async () => {
    const { materializer, prompt, store, blobs } = await fixture();
    const stored = await store.getAttachment(AttachmentIdSchema.parse('att-1'));
    if (!stored) throw new Error('fixture attachment missing');
    const fileCapability: AttachmentCapability = {
      kinds: {
        file: {
          mimeTypes: ['image/png'],
          maxBytes: MAX_ATTACHMENT_BYTES,
          maxCount: 1,
        },
      },
      representations: ['readonly_file'],
    };
    await store.commitAttachment({
      blob: { blobId: stored.blobId, sizeBytes: stored.sizeBytes, createdAt: 1 },
      attachment: { ...stored, kind: 'file' },
    });
    const filePrompt: PromptRecord = {
      ...prompt,
      blocks: [{ type: 'attachment_ref', attachmentId: stored.attachmentId }],
    };
    const sessionId = SessionIdSchema.parse('sess-1');
    const runId = RunIdSchema.parse('run-1');
    const prepared = await Effect.runPromise(
      materializer.prepare(sessionId, runId, filePrompt, fileCapability),
    );
    const file = prepared.blocks[0];
    expect(file.type).toBe('readonly_file');
    if (file.type !== 'readonly_file') return;
    expect((await stat(file.path)).nlink).toBeGreaterThanOrEqual(2);
    expect((await stat(file.path)).mode & 0o222).toBe(0);
    expect(await blobs.stat(stored.blobId)).toEqual({ sizeBytes: PNG_1X1.byteLength });

    await materializer.cleanupRun(sessionId, runId);
    await expect(stat(file.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await blobs.stat(stored.blobId)).toEqual({ sizeBytes: PNG_1X1.byteLength });

    const again = await Effect.runPromise(
      materializer.prepare(sessionId, runId, filePrompt, fileCapability),
    );
    const againFile = again.blocks[0];
    expect(againFile.type).toBe('readonly_file');
    if (againFile.type !== 'readonly_file') return;
    await materializer.bootSweep();
    await expect(stat(againFile.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not traverse out of the materialized directory on cleanup', async () => {
    const { materializer, root } = await fixture();
    const retained = join(root, 'retained.txt');
    await writeFile(retained, 'safe');
    await materializer.cleanupSession(SessionIdSchema.parse('..'));
    await materializer.cleanupRun(SessionIdSchema.parse('..'), RunIdSchema.parse('..'));
    expect(await readFile(retained, 'utf8')).toBe('safe');
  });
});
