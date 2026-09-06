import {
  ATTACHMENT_UPLOAD_CHUNK_BASE64_MAX,
  ATTACHMENT_UPLOAD_CHUNK_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_NAME_LENGTH,
  MAX_MIME_TYPE_LENGTH,
  WIRE_PROTOCOL_VERSION,
  WireMessageSchema,
} from '@linkcode/schema';
import { describe, expect, it } from 'vitest';

function parses(payload: unknown): boolean {
  return WireMessageSchema.safeParse({
    v: WIRE_PROTOCOL_VERSION,
    id: 'message-1',
    ts: 0,
    payload,
  }).success;
}

const sha256 = 'a'.repeat(64);
const blobId = `sha256:${sha256}`;

describe('attachment upload/read frames', () => {
  it('round-trips begin, chunk, commit, abort, and read', () => {
    expect(
      parses({
        kind: 'attachment.upload.begin',
        clientReqId: 'request-1',
        declaredSha256: sha256,
        declaredSize: 16,
        name: 'shot.png',
        mimeType: 'image/png',
        attachmentKind: 'image',
      }),
    ).toBe(true);
    expect(
      parses({
        kind: 'attachment.upload.begun',
        replyTo: 'request-1',
        uploadId: 'upl-1',
        chunkBytes: ATTACHMENT_UPLOAD_CHUNK_BYTES,
        state: 'ready',
      }),
    ).toBe(true);
    expect(
      parses({
        kind: 'attachment.upload.chunk',
        clientReqId: 'request-2',
        uploadId: 'upl-1',
        offset: 0,
        data: 'aGVsbG8=',
      }),
    ).toBe(true);
    expect(
      parses({
        kind: 'attachment.upload.chunk.acked',
        replyTo: 'request-2',
        uploadId: 'upl-1',
        receivedBytes: 5,
      }),
    ).toBe(true);
    expect(
      parses({
        kind: 'attachment.upload.commit',
        clientReqId: 'request-3',
        uploadId: 'upl-1',
      }),
    ).toBe(true);
    expect(
      parses({
        kind: 'attachment.upload.committed',
        replyTo: 'request-3',
        attachmentId: 'att-1',
        blobId,
      }),
    ).toBe(true);
    expect(
      parses({
        kind: 'attachment.upload.abort',
        clientReqId: 'request-4',
        uploadId: 'upl-1',
      }),
    ).toBe(true);
    expect(
      parses({
        kind: 'attachment.read',
        clientReqId: 'request-5',
        sessionId: 'session-1',
        attachmentId: 'att-1',
        offset: 0,
        length: 16,
      }),
    ).toBe(true);
    expect(
      parses({
        kind: 'attachment.read.result',
        replyTo: 'request-5',
        sessionId: 'session-1',
        attachmentId: 'att-1',
        blobId,
        offset: 0,
        data: 'aGVsbG8=',
        sizeBytes: 5,
        eof: true,
      }),
    ).toBe(true);
  });

  it('rejects a path-shaped upload id, an oversized claim, and an over-budget chunk', () => {
    expect(
      parses({
        kind: 'attachment.upload.chunk',
        clientReqId: 'request-1',
        uploadId: '../escape',
        offset: 0,
        data: 'YQ==',
      }),
    ).toBe(false);
    expect(
      parses({
        kind: 'attachment.upload.begin',
        clientReqId: 'request-1',
        declaredSha256: sha256,
        declaredSize: MAX_ATTACHMENT_BYTES + 1,
        name: 'too-big.bin',
        attachmentKind: 'file',
      }),
    ).toBe(false);
    expect(
      parses({
        kind: 'attachment.upload.chunk',
        clientReqId: 'request-1',
        uploadId: 'upl-1',
        offset: 0,
        data: 'A'.repeat(ATTACHMENT_UPLOAD_CHUNK_BASE64_MAX + 1),
      }),
    ).toBe(false);
  });

  it('keeps one chunk frame inside the tunnel budget', () => {
    // 341 KiB of base64 for 256 KiB raw: one tunnel chunk frame, far under workerd's 1 MiB cap.
    expect(ATTACHMENT_UPLOAD_CHUNK_BYTES).toBe(262_144);
    expect(ATTACHMENT_UPLOAD_CHUNK_BASE64_MAX).toBe(349_528);
    expect(ATTACHMENT_UPLOAD_CHUNK_BASE64_MAX).toBeLessThan(768 * 1024);
  });

  it('rejects a reply that drops a required field', () => {
    expect(
      parses({
        kind: 'attachment.read.result',
        replyTo: 'request-1',
        sessionId: 'session-1',
        attachmentId: 'att-1',
        blobId,
        offset: 0,
        data: 'aGVsbG8=',
        eof: true,
      }),
    ).toBe(false);
    expect(
      parses({
        kind: 'attachment.upload.begun',
        replyTo: 'request-1',
        uploadId: 'upl-1',
        state: 'ready',
      }),
    ).toBe(false);
  });

  it('accepts a begin without operationId and an exists short-circuit', () => {
    expect(
      parses({
        kind: 'attachment.upload.begin',
        clientReqId: 'request-1',
        declaredSha256: sha256,
        declaredSize: 0,
        name: 'empty.bin',
        attachmentKind: 'file',
      }),
    ).toBe(true);
    expect(
      parses({
        kind: 'attachment.upload.begun',
        replyTo: 'request-1',
        uploadId: 'upl-1',
        chunkBytes: ATTACHMENT_UPLOAD_CHUNK_BYTES,
        state: 'exists',
      }),
    ).toBe(true);
  });

  it('caps the name and MIME type a begin may persist onto every projected row', () => {
    const begin = {
      kind: 'attachment.upload.begin',
      clientReqId: 'request-1',
      declaredSha256: sha256,
      declaredSize: 1,
      attachmentKind: 'file',
    };
    expect(parses({ ...begin, name: 'x'.repeat(MAX_ATTACHMENT_NAME_LENGTH) })).toBe(true);
    expect(parses({ ...begin, name: 'x'.repeat(MAX_ATTACHMENT_NAME_LENGTH + 1) })).toBe(false);
    expect(parses({ ...begin, name: 'x', mimeType: 'a'.repeat(MAX_MIME_TYPE_LENGTH + 1) })).toBe(
      false,
    );
    expect(
      parses({
        kind: 'resource.source.upload',
        clientReqId: 'request-1',
        sessionId: 'session-1',
        name: 'x'.repeat(MAX_ATTACHMENT_NAME_LENGTH + 1),
        data: 'YQ==',
      }),
    ).toBe(false);
  });
});
