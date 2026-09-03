import {
  ATTACHMENT_STORE_WIRE_VERSION,
  AttachmentIdSchema,
  BlobIdSchema,
  SessionIdSchema,
  UploadIdSchema,
} from '@linkcode/schema';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import { LinkCodeClient } from '../../src/client';
import { base64ToBytes, bytesToBase64, sha256Hex } from '../../src/client/blob-cache';
import { createConnectedLocalClient } from '../support/local-client';

describe('LinkCodeClient attachment store API', () => {
  it('advertises the store only for hosts at or above its wire version', async () => {
    const current = await createConnectedLocalClient();
    expect(current.client.supportsAttachmentStore).toBe(true);
    current.client.dispose();
    current.serverTransport.close();

    const [clientTransport, serverTransport] = createLocalTransportPair();
    await serverTransport.connect();
    serverTransport.onMessage((message) => {
      if (message.payload.kind === 'ping') {
        serverTransport.send(
          createWireMessage({
            kind: 'pong',
            version: ATTACHMENT_STORE_WIRE_VERSION - 1,
            minCompatible: ATTACHMENT_STORE_WIRE_VERSION - 4,
          }),
        );
      }
    });
    const older = new LinkCodeClient(clientTransport);
    await older.connect();
    expect(older.supportsAttachmentStore).toBe(false);
    older.dispose();
    serverTransport.close();
  });

  it('uploads and reads through correlated frames and caches by blobId', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const bytes = new TextEncoder().encode('cached blob');
    const digest = await sha256Hex(bytes);
    const blobId = BlobIdSchema.parse(`sha256:${digest}`);
    const attachmentId = AttachmentIdSchema.parse('att-1');
    const sessionId = SessionIdSchema.parse('session-1');

    serverTransport.onMessage((message) => {
      const p = message.payload;
      if (p.kind === 'attachment.upload.begin') {
        serverTransport.send(
          createWireMessage({
            kind: 'attachment.upload.begun',
            replyTo: p.clientReqId,
            uploadId: UploadIdSchema.parse('upl-1'),
            chunkBytes: 256 * 1024,
            state: 'ready',
          }),
        );
      }
      if (p.kind === 'attachment.upload.chunk') {
        serverTransport.send(
          createWireMessage({
            kind: 'attachment.upload.chunk.acked',
            replyTo: p.clientReqId,
            uploadId: p.uploadId,
            receivedBytes: p.offset + base64ToBytes(p.data).byteLength,
          }),
        );
      }
      if (p.kind === 'attachment.upload.commit') {
        serverTransport.send(
          createWireMessage({
            kind: 'attachment.upload.committed',
            replyTo: p.clientReqId,
            attachmentId,
            blobId,
          }),
        );
      }
      if (p.kind === 'attachment.read') {
        serverTransport.send(
          createWireMessage({
            kind: 'attachment.read.result',
            replyTo: p.clientReqId,
            sessionId: p.sessionId,
            attachmentId: p.attachmentId,
            blobId,
            offset: p.offset,
            data: bytesToBase64(bytes.subarray(p.offset, p.offset + p.length)),
            sizeBytes: bytes.byteLength,
            eof: p.offset + p.length >= bytes.byteLength,
          }),
        );
      }
    });

    const put = await client.putAttachment({
      bytes,
      name: 'note.txt',
      mimeType: 'text/plain',
      attachmentKind: 'file',
    });
    expect(put).toEqual({ attachmentId, blobId });

    const got = await client.getAttachmentBytes(sessionId, attachmentId);
    expect(new TextDecoder().decode(got.bytes)).toBe('cached blob');
    expect(got.blobId).toBe(blobId);

    client.dispose();
    serverTransport.close();
  });
});
