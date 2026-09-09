import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asHistoryId } from '@linkcode/agent-adapter';
import type { WirePayload } from '@linkcode/schema';
import {
  AttachmentIdSchema,
  attachmentUri,
  blobIdFromSha256,
  OperationIdSchema,
} from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemoryAttachmentStore } from '../attachment/attachment-store';
import { FsBlobStore } from '../attachment/blob-store';
import { InMemoryConversationStore } from '../conversation/conversation-store';
import { InMemorySessionStore } from '../session/session-store';
import {
  createSessionHarness as harness,
  startedSessionId as startedId,
} from './fixtures/session-harness';

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

function failure(sent: WirePayload[], replyTo: string) {
  const reply = sent.find(
    (payload) => payload.kind === 'request.failed' && payload.replyTo === replyTo,
  );
  if (reply?.kind !== 'request.failed') throw new Error(`no request.failed for ${replyTo}`);
  return reply;
}

async function started(kind: 'claude-code' | 'grok-build' = 'claude-code') {
  const stateDir = await mkdtemp(join(tmpdir(), 'linkcode-attach-submit-'));
  temporaryDirectories.push(stateDir);
  const conversationStore = new InMemoryConversationStore();
  const attachmentStore = new InMemoryAttachmentStore(
    () => conversationStore.referencedAttachmentIds(),
    (sessionId, attachmentId) =>
      conversationStore.referencedAttachmentIdsForSession(sessionId).includes(attachmentId),
  );
  const blobStore = new FsBlobStore(join(stateDir, 'blobs'));
  const h = harness(
    new InMemorySessionStore(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      conversationStore,
      attachmentStore,
      blobStore,
      stateDir,
    },
  );
  await h.engine.start();
  await h.inject({
    kind: 'session.start',
    clientReqId: 'r1',
    opts: { kind, cwd: stateDir },
  });
  return {
    ...h,
    conversationStore,
    attachmentStore,
    blobStore,
    stateDir,
    sessionId: startedId(h.sent, 'r1'),
    adapter: nullthrow(h.adapters[0]),
  };
}

async function readyPng(h: Awaited<ReturnType<typeof started>>) {
  const digest = sha256(PNG_1X1);
  const blobId = blobIdFromSha256(digest);
  const stage = await h.blobStore.stage('up-1');
  await stage.write(0, PNG_1X1);
  await stage.commit({ sha256: digest, sizeBytes: PNG_1X1.byteLength });
  const attachmentId = AttachmentIdSchema.parse('att-ready');
  await h.attachmentStore.commitAttachment({
    blob: { blobId, sizeBytes: PNG_1X1.byteLength, createdAt: 1 },
    attachment: {
      attachmentId,
      kind: 'image',
      name: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: PNG_1X1.byteLength,
      metadata: {},
      createdAt: 1,
    },
  });
  return attachmentId;
}

describe('turn.submit attachment admit and materialize', () => {
  it('refuses a missing ref at admit and persists nothing', async () => {
    const h = await started();
    await h.inject({
      kind: 'turn.submit',
      clientReqId: 's-missing',
      sessionId: h.sessionId,
      operationId: OperationIdSchema.parse('op-missing'),
      input: {
        type: 'prompt',
        blocks: [{ type: 'attachment_ref', attachmentId: AttachmentIdSchema.parse('att-missing') }],
      },
    });
    expect(failure(h.sent, 's-missing').code).toBe('unsupported_attachment');
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(0);
  });

  it('refuses an image on grok-build at admit without touching the store', async () => {
    const h = await started('grok-build');
    const attachmentId = await readyPng(h);
    const list = vi.spyOn(h.attachmentStore, 'listAttachments');
    await h.inject({
      kind: 'turn.submit',
      clientReqId: 's-grok',
      sessionId: h.sessionId,
      operationId: OperationIdSchema.parse('op-grok'),
      input: {
        type: 'prompt',
        blocks: [
          { type: 'text', text: 'look' },
          { type: 'attachment_ref', attachmentId },
        ],
      },
    });
    expect(failure(h.sent, 's-grok')).toMatchObject({
      code: 'unsupported_attachment',
    });
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(0);
    expect(h.adapter.sentInputs).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it('materializes a declared image to the adapter without putting bytes on the echo or prompt row', async () => {
    const h = await started();
    const attachmentId = await readyPng(h);
    await h.inject({
      kind: 'turn.submit',
      clientReqId: 's-ok',
      sessionId: h.sessionId,
      operationId: OperationIdSchema.parse('op-ok'),
      input: {
        type: 'prompt',
        blocks: [
          { type: 'text', text: 'look' },
          { type: 'attachment_ref', attachmentId },
        ],
      },
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'turn.submitted', replyTo: 's-ok' }),
      );
    });
    expect(h.adapter.sentInputs).toEqual([
      {
        type: 'prompt',
        content: [
          { type: 'text', text: 'look' },
          {
            type: 'image',
            data: PNG_1X1.toString('base64'),
            mimeType: 'image/png',
            name: 'shot.png',
          },
        ],
      },
    ]);
    const echo = h.sent.find(
      (payload) => payload.kind === 'agent.event' && payload.event.type === 'user-message',
    );
    if (echo?.kind !== 'agent.event' || echo.event.type !== 'user-message') {
      throw new Error('no live prompt echo');
    }
    expect(echo.event.content).toEqual([{ type: 'text', text: 'look' }]);
    expect(JSON.stringify(echo.event.content)).not.toContain(PNG_1X1.toString('base64'));

    const turns = await h.conversationStore.listTurns(h.sessionId);
    expect(turns).toHaveLength(1);
    const turnInput = nullthrow(turns[0], 'expected a persisted turn').input;
    expect(turnInput.type).toBe('prompt');
    const promptId = nullthrow(
      turnInput.type === 'prompt' ? turnInput.promptId : null,
      'a prompt turn must persist a promptId',
    );
    const prompt = await h.conversationStore.getPrompt(promptId);
    expect(prompt?.blocks).toEqual([
      { type: 'text', text: 'look' },
      { type: 'attachment_ref', attachmentId },
    ]);

    await h.inject({ kind: 'conversation.read', clientReqId: 'rr', sessionId: h.sessionId });
    const read = h.sent.find(
      (payload) => payload.kind === 'conversation.read.result' && payload.replyTo === 'rr',
    );
    if (read?.kind !== 'conversation.read.result') throw new Error('no conversation.read.result');
    const row = read.events.find((item) => 'event' in item && item.event.type === 'user-message');
    if (row === undefined || !('event' in row) || row.event.type !== 'user-message') {
      throw new Error('no user row');
    }
    expect(row.event.content).toEqual([
      { type: 'text', text: 'look' },
      {
        type: 'resource_link',
        uri: attachmentUri(attachmentId),
        name: 'shot.png',
        mimeType: 'image/png',
        size: PNG_1X1.byteLength,
        description: 'image',
      },
    ]);
    expect(JSON.stringify(row.event.content)).not.toContain(PNG_1X1.toString('base64'));
  });

  it('refuses a rewrite that round-trips the projected resource_link before persist', async () => {
    const h = await started();
    const attachmentId = await readyPng(h);
    await h.inject({
      kind: 'turn.submit',
      clientReqId: 's-ok',
      sessionId: h.sessionId,
      operationId: OperationIdSchema.parse('op-ok'),
      input: {
        type: 'prompt',
        blocks: [
          { type: 'text', text: 'look' },
          { type: 'attachment_ref', attachmentId },
        ],
      },
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'turn.submitted', replyTo: 's-ok' }),
      );
    });
    h.adapter.emit({ type: 'session-ref', historyId: asHistoryId('native-1') });
    h.adapter.emit({ type: 'status', status: 'idle' });
    await h.inject({ kind: 'conversation.read', clientReqId: 'rr', sessionId: h.sessionId });
    const read = h.sent.find(
      (payload) => payload.kind === 'conversation.read.result' && payload.replyTo === 'rr',
    );
    if (read?.kind !== 'conversation.read.result') throw new Error('no conversation.read.result');
    const row = read.events.find((item) => 'event' in item && item.event.type === 'user-message');
    if (
      row === undefined ||
      !('event' in row) ||
      row.event.type !== 'user-message' ||
      row.event.branchCursor === undefined
    ) {
      throw new Error('no user row with a branch cursor');
    }
    const turnsBefore = await h.conversationStore.listTurns(h.sessionId);

    await h.inject({
      kind: 'history.branch',
      clientReqId: 'rewrite',
      sourceSessionId: h.sessionId,
      sourceMessageId: row.event.messageId,
      branchCursor: row.event.branchCursor,
      content: [
        { type: 'text', text: 'look again' },
        {
          type: 'resource_link',
          uri: attachmentUri(attachmentId),
          name: 'shot.png',
        },
      ],
    });

    expect(failure(h.sent, 'rewrite')).toMatchObject({
      code: 'unsupported_attachment',
      message: 'Editing a prompt attachment is not supported yet',
    });
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(turnsBefore.length);
    expect(h.adapter.sentInputs).toHaveLength(1);
  });
});

describe('legacy agent.input inline images', () => {
  const image = {
    type: 'image' as const,
    data: PNG_1X1.toString('base64'),
    mimeType: 'image/png',
    name: 'shot.png',
  };

  it('stores the image as a ref on the durable row while the adapter and echo keep it inline', async () => {
    const h = await started();
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'legacy',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [{ type: 'text', text: 'look' }, image] },
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'request.succeeded', replyTo: 'legacy' }),
      );
    });
    expect(h.adapter.sentInputs).toEqual([
      { type: 'prompt', content: [{ type: 'text', text: 'look' }, image] },
    ]);
    const echo = h.sent.find(
      (payload) => payload.kind === 'agent.event' && payload.event.type === 'user-message',
    );
    if (echo?.kind !== 'agent.event' || echo.event.type !== 'user-message') {
      throw new Error('no live prompt echo');
    }
    expect(echo.event.content).toEqual([{ type: 'text', text: 'look' }, image]);

    const [turn] = await h.conversationStore.listTurns(h.sessionId);
    const turnInput = nullthrow(turn, 'expected a persisted turn').input;
    const promptId = nullthrow(
      turnInput.type === 'prompt' ? turnInput.promptId : null,
      'a prompt turn must persist a promptId',
    );
    const prompt = nullthrow(await h.conversationStore.getPrompt(promptId));
    const ref = prompt.blocks[1];
    if (ref?.type !== 'attachment_ref') throw new Error('expected an attachment_ref');
    expect(prompt.blocks[0]).toEqual({ type: 'text', text: 'look' });
    expect(JSON.stringify(prompt.blocks)).not.toContain(image.data);

    await h.inject({ kind: 'conversation.read', clientReqId: 'rr', sessionId: h.sessionId });
    const read = h.sent.find(
      (payload) => payload.kind === 'conversation.read.result' && payload.replyTo === 'rr',
    );
    if (read?.kind !== 'conversation.read.result') throw new Error('no conversation.read.result');
    const row = read.events.find((item) => 'event' in item && item.event.type === 'user-message');
    if (row === undefined || !('event' in row) || row.event.type !== 'user-message') {
      throw new Error('no user row');
    }
    expect(row.event.content).toEqual([
      { type: 'text', text: 'look' },
      {
        type: 'resource_link',
        uri: attachmentUri(ref.attachmentId),
        name: 'shot.png',
        mimeType: 'image/png',
        size: PNG_1X1.byteLength,
        description: 'image',
      },
    ]);

    await h.inject({
      kind: 'attachment.read',
      clientReqId: 'read',
      sessionId: h.sessionId,
      attachmentId: ref.attachmentId,
      offset: 0,
      length: PNG_1X1.byteLength,
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'attachment.read.result', replyTo: 'read' }),
      );
    });
    const page = h.sent.find(
      (payload) => payload.kind === 'attachment.read.result' && payload.replyTo === 'read',
    );
    if (page?.kind !== 'attachment.read.result') throw new Error('no attachment.read.result');
    expect(page.data).toBe(image.data);
  });

  it('refuses an image whose bytes are not the declared type before any echo or row', async () => {
    const h = await started();
    await h.inject({
      kind: 'agent.input',
      clientReqId: 'lie',
      sessionId: h.sessionId,
      input: {
        type: 'prompt',
        content: [
          {
            type: 'image',
            mimeType: 'image/png',
            data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'),
          },
        ],
      },
    });
    expect(failure(h.sent, 'lie')).toMatchObject({
      code: 'invalid_request',
      message: 'File contents are not image/png',
    });
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(0);
    expect(h.adapter.sentInputs).toEqual([]);
    expect(h.sent.some((p) => p.kind === 'agent.event' && p.event.type === 'user-message')).toBe(
      false,
    );
  });

  it('fails typed when the store cannot take the bytes and leaves the session usable', async () => {
    const h = await started();
    const blobsDir = join(h.stateDir, 'blobs');
    await mkdir(blobsDir, { recursive: true });
    await chmod(blobsDir, 0o500);
    try {
      await h.inject({
        kind: 'agent.input',
        clientReqId: 'ro',
        sessionId: h.sessionId,
        input: { type: 'prompt', content: [{ type: 'text', text: 'look' }, image] },
      });
      await vi.waitFor(() => {
        expect(failure(h.sent, 'ro')).toMatchObject({
          code: 'operation_failed',
          message: 'Failed to store a prompt attachment',
        });
      });
    } finally {
      await chmod(blobsDir, 0o700);
    }
    expect(await h.conversationStore.listTurns(h.sessionId)).toHaveLength(0);
    expect(h.adapter.sentInputs).toEqual([]);

    await h.inject({
      kind: 'agent.input',
      clientReqId: 'after',
      sessionId: h.sessionId,
      input: { type: 'prompt', content: [{ type: 'text', text: 'still here' }] },
    });
    await vi.waitFor(() => {
      expect(h.sent).toContainEqual(
        expect.objectContaining({ kind: 'request.succeeded', replyTo: 'after' }),
      );
    });
  });
});
