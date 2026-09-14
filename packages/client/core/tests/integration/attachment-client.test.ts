import {
  ATTACHMENT_STORE_WIRE_VERSION,
  ATTACHMENT_UPLOAD_CHUNK_BYTES,
  AttachmentIdSchema,
  BlobIdSchema,
  SessionIdSchema,
  UploadIdSchema,
} from '@linkcode/schema';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import { LinkCodeClient } from '../../src/client';
import {
  AttachmentBlobCache,
  base64ToBytes,
  bytesToBase64,
  sha256Hex,
} from '../../src/client/blob-cache';
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

  it('pipelines a multi-chunk upload past a receiver that only accepts the next offset', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const bytes = new Uint8Array(ATTACHMENT_UPLOAD_CHUNK_BYTES * 2 + 9).fill(7);
    const blobId = BlobIdSchema.parse(`sha256:${'c'.repeat(64)}`);
    const offsets: number[] = [];
    let received = 0;

    serverTransport.onMessage((message) => {
      const p = message.payload;
      if (p.kind === 'attachment.upload.begin') {
        serverTransport.send(
          createWireMessage({
            kind: 'attachment.upload.begun',
            replyTo: p.clientReqId,
            uploadId: UploadIdSchema.parse('upl-2'),
            chunkBytes: ATTACHMENT_UPLOAD_CHUNK_BYTES,
            state: 'ready',
          }),
        );
      }
      // The daemon's contract: strictly the next contiguous offset, acked cumulatively.
      if (p.kind === 'attachment.upload.chunk') {
        offsets.push(p.offset);
        if (p.offset !== received) {
          serverTransport.send(
            createWireMessage({
              kind: 'request.failed',
              replyTo: p.clientReqId,
              message: `Expected offset ${received}, got ${p.offset}`,
              code: 'invalid_request',
            }),
          );
          return;
        }
        received += base64ToBytes(p.data).byteLength;
        serverTransport.send(
          createWireMessage({
            kind: 'attachment.upload.chunk.acked',
            replyTo: p.clientReqId,
            uploadId: p.uploadId,
            receivedBytes: received,
          }),
        );
      }
      if (p.kind === 'attachment.upload.commit') {
        serverTransport.send(
          createWireMessage({
            kind: 'attachment.upload.committed',
            replyTo: p.clientReqId,
            attachmentId: AttachmentIdSchema.parse('att-2'),
            blobId,
          }),
        );
      }
    });

    await client.putAttachment({ bytes, name: 'big.bin', attachmentKind: 'file' });
    expect(offsets).toEqual([0, ATTACHMENT_UPLOAD_CHUNK_BYTES, ATTACHMENT_UPLOAD_CHUNK_BYTES * 2]);
    expect(received).toBe(bytes.byteLength);

    client.dispose();
    serverTransport.close();
  });

  it('assembles a multi-page read once and serves the rest from the cache', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const bytes = new Uint8Array(ATTACHMENT_UPLOAD_CHUNK_BYTES + 31).fill(3);
    const blobId = BlobIdSchema.parse(`sha256:${'d'.repeat(64)}`);
    const attachmentId = AttachmentIdSchema.parse('att-3');
    const sessionId = SessionIdSchema.parse('session-1');
    let reads = 0;

    serverTransport.onMessage((message) => {
      const p = message.payload;
      if (p.kind !== 'attachment.read') return;
      reads += 1;
      const slice = bytes.subarray(p.offset, p.offset + p.length);
      serverTransport.send(
        createWireMessage({
          kind: 'attachment.read.result',
          replyTo: p.clientReqId,
          sessionId: p.sessionId,
          attachmentId: p.attachmentId,
          blobId,
          offset: p.offset,
          data: bytesToBase64(slice),
          sizeBytes: bytes.byteLength,
          eof: p.offset + slice.byteLength >= bytes.byteLength,
        }),
      );
    });

    const first = await client.getAttachmentBytes(sessionId, attachmentId);
    expect(first.bytes).toEqual(bytes);
    expect(reads).toBe(2);
    const again = await client.getAttachmentBytes(sessionId, attachmentId);
    expect(again.bytes).toEqual(bytes);
    // Only the one probe page: the rest came from the blobId cache.
    expect(reads).toBe(3);

    client.dispose();
    serverTransport.close();
  });

  it('fails the read walk instead of spinning when the bytes run out early', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const bytes = new Uint8Array(16).fill(1);
    const blobId = BlobIdSchema.parse(`sha256:${'e'.repeat(64)}`);
    const attachmentId = AttachmentIdSchema.parse('att-4');
    const sessionId = SessionIdSchema.parse('session-1');
    let reads = 0;

    serverTransport.onMessage((message) => {
      const p = message.payload;
      if (p.kind !== 'attachment.read') return;
      reads += 1;
      const slice = bytes.subarray(p.offset, p.offset + p.length);
      serverTransport.send(
        createWireMessage({
          kind: 'attachment.read.result',
          replyTo: p.clientReqId,
          sessionId: p.sessionId,
          attachmentId: p.attachmentId,
          blobId,
          offset: p.offset,
          data: bytesToBase64(slice),
          // A row that outlived some of its bytes: the size never becomes reachable.
          sizeBytes: bytes.byteLength * 4,
          eof: false,
        }),
      );
    });

    await expect(client.getAttachmentBytes(sessionId, attachmentId)).rejects.toThrow('att-4');
    expect(reads).toBe(2);

    client.dispose();
    serverTransport.close();
  });

  it('aborts the upload when a chunk is rejected', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const bytes = new Uint8Array(ATTACHMENT_UPLOAD_CHUNK_BYTES * 2).fill(5);
    const uploadId = UploadIdSchema.parse('upl-3');
    let aborted: string | undefined;

    serverTransport.onMessage((message) => {
      const p = message.payload;
      if (p.kind === 'attachment.upload.begin') {
        serverTransport.send(
          createWireMessage({
            kind: 'attachment.upload.begun',
            replyTo: p.clientReqId,
            uploadId,
            chunkBytes: ATTACHMENT_UPLOAD_CHUNK_BYTES,
            state: 'ready',
          }),
        );
      }
      if (p.kind === 'attachment.upload.chunk') {
        serverTransport.send(
          createWireMessage({
            kind: 'request.failed',
            replyTo: p.clientReqId,
            message: 'disk is full',
            code: 'invalid_request',
          }),
        );
      }
      if (p.kind === 'attachment.upload.abort') {
        aborted = p.uploadId;
        serverTransport.send(
          createWireMessage({ kind: 'request.succeeded', replyTo: p.clientReqId }),
        );
      }
    });

    await expect(
      client.putAttachment({ bytes, name: 'doomed.bin', attachmentKind: 'file' }),
    ).rejects.toThrow('disk is full');
    expect(aborted).toBe(uploadId);

    client.dispose();
    serverTransport.close();
  });
});

describe('AttachmentBlobCache', () => {
  it('evicts the least recently read blob once the byte budget is spent', () => {
    const cache = new AttachmentBlobCache(10);
    cache.set('a', new Uint8Array(4));
    cache.set('b', new Uint8Array(4));
    expect(cache.get('a')).toBeDefined();
    cache.set('c', new Uint8Array(4));
    // 'b' was the least recently read of the two that fit alongside 'c'.
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);

    cache.set('huge', new Uint8Array(40));
    expect(cache.has('huge')).toBe(true);
    expect(cache.has('a')).toBe(false);
  });
});
