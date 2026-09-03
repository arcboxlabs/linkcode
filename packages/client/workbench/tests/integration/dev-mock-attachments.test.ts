import { LinkCodeClient } from '@linkcode/client-core';
import { ATTACHMENT_UPLOAD_CHUNK_BYTES, AttachmentIdSchema } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { createDevMockTransport } from '../../src/mock/dev-mock-transport';

async function connectedClient(): Promise<LinkCodeClient> {
  const client = new LinkCodeClient(createDevMockTransport());
  await client.connect();
  return client;
}

describe('dev mock attachment store', () => {
  it('round-trips a multi-chunk upload and dedupes the second copy', async () => {
    const client = await connectedClient();
    const sessionId = await client.startSession({ kind: 'codex', cwd: '/mock/repo' });
    const bytes = new Uint8Array(ATTACHMENT_UPLOAD_CHUNK_BYTES + 17);
    for (let i = 0; i < bytes.byteLength; i++) bytes[i] = i % 251;

    const first = await client.putAttachment({ bytes, name: 'shot.bin', attachmentKind: 'file' });
    const read = await client.getAttachmentBytes(sessionId, first.attachmentId);
    expect(read.bytes).toEqual(bytes);
    expect(read.blobId).toBe(first.blobId);

    // Same bytes, new record: the mock must answer `exists` and transfer nothing.
    const second = await client.putAttachment({ bytes, name: 'copy.bin', attachmentKind: 'file' });
    expect(second.blobId).toBe(first.blobId);
    expect(second.attachmentId).not.toBe(first.attachmentId);
    client.dispose();
  });

  it('rejects an unknown attachment and a chunk at the wrong offset', async () => {
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
    client.dispose();
  });
});
