import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  const attachmentStore = new InMemoryAttachmentStore(() =>
    conversationStore.referencedAttachmentIds(),
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

  it('refuses an image on grok-build at admit', async () => {
    const h = await started('grok-build');
    const attachmentId = await readyPng(h);
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
    if (turnInput.type !== 'prompt' || turnInput.promptId === null) return;
    const prompt = await h.conversationStore.getPrompt(turnInput.promptId);
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
        title: 'image',
      },
    ]);
    expect(JSON.stringify(row.event.content)).not.toContain(PNG_1X1.toString('base64'));
  });
});
