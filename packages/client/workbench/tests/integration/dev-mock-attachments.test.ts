import { LinkCodeClient } from '@linkcode/client-core';
import type { AttachmentId, SessionId } from '@linkcode/schema';
import {
  ATTACHMENT_UPLOAD_CHUNK_BYTES,
  AttachmentIdSchema,
  OperationIdSchema,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { describe, expect, it } from 'vitest';
import { createDevMockTransport } from '../../src/mock/dev-mock-transport';

async function connectedClient(): Promise<LinkCodeClient> {
  const client = new LinkCodeClient(createDevMockTransport());
  await client.connect();
  return client;
}

/** `turn.submit` has no client-core method yet (CODE-638), so the prompt-ref root is driven raw. */
function submitPromptRef(
  transport: Transport,
  sessionId: SessionId,
  attachmentId: AttachmentId,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const clientReqId = 'creq-attachment-ref';
    const unsubscribe = transport.onMessage((message) => {
      const p = message.payload;
      if (!('replyTo' in p) || p.replyTo !== clientReqId) return;
      unsubscribe();
      if (p.kind === 'turn.submitted') resolve();
      else reject(new Error(p.kind === 'request.failed' ? p.message : `unexpected ${p.kind}`));
    });
    transport.send(
      createWireMessage({
        kind: 'turn.submit',
        clientReqId,
        sessionId,
        operationId: OperationIdSchema.parse('op-attachment-ref'),
        input: {
          type: 'prompt',
          blocks: [
            { type: 'text', text: 'look at this' },
            { type: 'attachment_ref', attachmentId },
          ],
        },
      }),
    );
  });
}

describe('dev mock attachment store', () => {
  it('round-trips a multi-chunk upload and dedupes the second copy', async () => {
    const client = await connectedClient();
    await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    const bytes = new Uint8Array(ATTACHMENT_UPLOAD_CHUNK_BYTES + 17);
    for (let i = 0; i < bytes.byteLength; i++) bytes[i] = i % 251;

    const first = await client.putAttachment({ bytes, name: 'shot.bin', attachmentKind: 'file' });
    // Same bytes, new record: the mock must answer `exists` and transfer nothing.
    const second = await client.putAttachment({ bytes, name: 'copy.bin', attachmentKind: 'file' });
    expect(second.blobId).toBe(first.blobId);
    expect(second.attachmentId).not.toBe(first.attachmentId);
    client.dispose();
  });

  it('reads an attachment only from a session that roots it', async () => {
    const client = await connectedClient();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    const bytes = new TextEncoder().encode('resource bytes');

    // An upload alone is a draft lease — the daemon's isReachable roots nothing yet.
    const draft = await client.putAttachment({ bytes, name: 'draft.txt', attachmentKind: 'file' });
    await expect(client.getAttachmentBytes(sessionId, draft.attachmentId)).rejects.toThrow(
      'Attachment not found',
    );

    // A session resource is a root, and carries the attachment its bytes landed in.
    const resource = await client.uploadSource(
      sessionId,
      'brief.txt',
      btoa('resource bytes'),
      'text/plain',
    );
    const attachmentId = nullthrow(resource.attachmentId, 'resource missing attachmentId');
    const read = await client.getAttachmentBytes(sessionId, attachmentId);
    expect(read.bytes).toEqual(bytes);

    const otherSession = await client.startSession({ kind: 'codex', cwd: '/mock/other' });
    await expect(client.getAttachmentBytes(otherSession, attachmentId)).rejects.toThrow(
      'Attachment not found',
    );
    client.dispose();
  });

  it('roots a draft attachment once a prompt of that session references it', async () => {
    const transport = createDevMockTransport();
    const client = new LinkCodeClient(transport);
    await client.connect();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    const bytes = new TextEncoder().encode('attached by prompt');
    const draft = await client.putAttachment({ bytes, name: 'note.txt', attachmentKind: 'file' });

    await expect(client.getAttachmentBytes(sessionId, draft.attachmentId)).rejects.toThrow(
      'Attachment not found',
    );
    await submitPromptRef(transport, sessionId, draft.attachmentId);
    const read = await client.getAttachmentBytes(sessionId, draft.attachmentId);
    expect(read.bytes).toEqual(bytes);
    client.dispose();
  });

  it('rejects an unknown attachment, a wrong offset, and bytes that are not the declared image', async () => {
    const client = await connectedClient();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    await expect(
      client.readAttachment(sessionId, AttachmentIdSchema.parse('att-nope'), 0, 16),
    ).rejects.toThrow('Attachment not found');

    const begun = await client.beginAttachmentUpload({
      declaredSha256: 'b'.repeat(64),
      declaredSize: 32,
      name: 'offset.bin',
      attachmentKind: 'file',
    });
    await expect(client.sendAttachmentChunk(begun.uploadId, 8, 'YQ==')).rejects.toThrow(
      'Expected offset 0',
    );

    await expect(
      client.putAttachment({
        bytes: new TextEncoder().encode('not a png'),
        name: 'fake.png',
        mimeType: 'image/png',
        attachmentKind: 'image',
      }),
    ).rejects.toThrow('File contents are not image/png');
    client.dispose();
  });
});
