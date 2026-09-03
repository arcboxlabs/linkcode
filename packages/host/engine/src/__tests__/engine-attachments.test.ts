import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WirePayload } from '@linkcode/schema';
import { ATTACHMENT_UPLOAD_CHUNK_BYTES, SessionIdSchema } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionHarness, startedSessionId } from './fixtures/session-harness';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function tempDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'linkcode-attachments-'));
  temporaryDirectories.push(path);
  return path;
}

function replyOf<K extends WirePayload['kind']>(
  sent: WirePayload[],
  kind: K,
  replyTo: string,
): Extract<WirePayload, { kind: K }> {
  const reply = sent.find(
    (payload) => payload.kind === kind && 'replyTo' in payload && payload.replyTo === replyTo,
  );
  if (reply?.kind !== kind) throw new Error(`no ${kind} for ${replyTo}`);
  return reply as Extract<WirePayload, { kind: K }>;
}

describe('engine attachment upload/read', () => {
  it('uploads through the wire, then reads after a session resource roots the attachment', async () => {
    const stateDir = await tempDirectory();
    const h = createSessionHarness(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { stateDir },
    );
    await h.engine.start();
    await h.inject({
      kind: 'session.start',
      clientReqId: 'start',
      opts: { kind: 'claude-code', cwd: stateDir },
    });
    const sessionId = startedSessionId(h.sent, 'start');
    const bytes = Buffer.from('wire upload');
    await h.inject({
      kind: 'attachment.upload.begin',
      clientReqId: 'begin',
      declaredSha256: sha256(bytes),
      declaredSize: bytes.byteLength,
      name: 'note.txt',
      mimeType: 'text/plain',
      attachmentKind: 'file',
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'attachment.upload.begun', replyTo: 'begin' }),
      );
    });
    const begun = replyOf(h.sent, 'attachment.upload.begun', 'begin');
    expect(begun.state).toBe('ready');
    expect(begun.chunkBytes).toBe(ATTACHMENT_UPLOAD_CHUNK_BYTES);

    await h.inject({
      kind: 'attachment.upload.chunk',
      clientReqId: 'bad-offset',
      uploadId: begun.uploadId,
      offset: 99,
      data: 'YQ==',
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({
          kind: 'request.failed',
          replyTo: 'bad-offset',
          code: 'invalid_request',
        }),
      );
    });

    await h.inject({
      kind: 'attachment.upload.chunk',
      clientReqId: 'chunk',
      uploadId: begun.uploadId,
      offset: 0,
      data: bytes.toString('base64'),
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'attachment.upload.chunk.acked', replyTo: 'chunk' }),
      );
    });

    await h.inject({
      kind: 'attachment.upload.commit',
      clientReqId: 'commit',
      uploadId: begun.uploadId,
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'attachment.upload.committed', replyTo: 'commit' }),
      );
    });
    const committed = replyOf(h.sent, 'attachment.upload.committed', 'commit');

    await h.inject({
      kind: 'resource.source.upload',
      clientReqId: 'resource',
      sessionId,
      name: 'note.txt',
      mimeType: 'text/plain',
      data: bytes.toString('base64'),
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'resource.uploaded', replyTo: 'resource' }),
      );
    });
    const resource = replyOf(h.sent, 'resource.uploaded', 'resource').resource;
    const attachmentId = nullthrow(resource.attachmentId, 'resource missing attachmentId');

    await h.inject({
      kind: 'attachment.read',
      clientReqId: 'read',
      sessionId,
      attachmentId,
      offset: 0,
      length: bytes.byteLength,
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'attachment.read.result', replyTo: 'read' }),
      );
    });
    const page = replyOf(h.sent, 'attachment.read.result', 'read');
    expect(Buffer.from(page.data, 'base64').toString()).toBe('wire upload');
    expect(page.blobId).toBe(committed.blobId);

    await h.inject({
      kind: 'attachment.read',
      clientReqId: 'cross',
      sessionId: SessionIdSchema.parse('session-other'),
      attachmentId,
      offset: 0,
      length: 4,
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'request.failed', replyTo: 'cross', code: 'not_found' }),
      );
    });
  });

  it('accepts two chunk frames delivered before the first write lands', async () => {
    const stateDir = await tempDirectory();
    const h = createSessionHarness(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        stateDir,
      },
    );
    await h.engine.start();
    const bytes = Buffer.alloc(ATTACHMENT_UPLOAD_CHUNK_BYTES + 11, 9);
    await h.inject({
      kind: 'attachment.upload.begin',
      clientReqId: 'begin',
      declaredSha256: sha256(bytes),
      declaredSize: bytes.byteLength,
      name: 'window.bin',
      attachmentKind: 'file',
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'attachment.upload.begun', replyTo: 'begin' }),
      );
    });
    const begun = replyOf(h.sent, 'attachment.upload.begun', 'begin');

    // Each frame is handled in its own fiber, so both are in flight before either write resolves.
    await Promise.all([
      h.inject({
        kind: 'attachment.upload.chunk',
        clientReqId: 'chunk-0',
        uploadId: begun.uploadId,
        offset: 0,
        data: bytes.subarray(0, ATTACHMENT_UPLOAD_CHUNK_BYTES).toString('base64'),
      }),
      h.inject({
        kind: 'attachment.upload.chunk',
        clientReqId: 'chunk-1',
        uploadId: begun.uploadId,
        offset: ATTACHMENT_UPLOAD_CHUNK_BYTES,
        data: bytes.subarray(ATTACHMENT_UPLOAD_CHUNK_BYTES).toString('base64'),
      }),
    ]);
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({
          kind: 'attachment.upload.chunk.acked',
          replyTo: 'chunk-1',
          receivedBytes: bytes.byteLength,
        }),
      );
    });

    await h.inject({
      kind: 'attachment.upload.commit',
      clientReqId: 'commit',
      uploadId: begun.uploadId,
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'attachment.upload.committed', replyTo: 'commit' }),
      );
    });
    expect(replyOf(h.sent, 'attachment.upload.committed', 'commit').blobId).toBe(
      `sha256:${sha256(bytes)}`,
    );
  });
});
