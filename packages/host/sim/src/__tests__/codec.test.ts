import { describe, expect, it } from 'vitest';
import {
  decodeScreenshotFrame,
  decodeStreamFrame,
  FrameDecoder,
  MAX_FRAME_LEN,
  RESULT,
  writeFrame,
} from '../codec';

function frame(type: number, body: Buffer): Buffer {
  const header = Buffer.allocUnsafe(5);
  header.writeUInt32LE(body.length + 1, 0);
  header[4] = type;
  return Buffer.concat([header, body]);
}

describe('FrameDecoder', () => {
  it('reassembles frames split at arbitrary byte boundaries', () => {
    const decoder = new FrameDecoder();
    const encoded = Buffer.concat([
      frame(RESULT, Buffer.from('{"a":1}')),
      frame(RESULT, Buffer.from('{"b":2}')),
    ]);
    const frames = [];
    for (const byte of encoded) {
      for (const decoded of decoder.feed(Buffer.from([byte]))) frames.push(decoded);
    }
    expect(frames.map((f) => f.body.toString())).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('rejects oversized frame lengths', () => {
    const decoder = new FrameDecoder();
    const header = Buffer.allocUnsafe(5);
    header.writeUInt32LE(MAX_FRAME_LEN + 1, 0);
    header[4] = RESULT;
    expect(() => decoder.feed(header)).toThrow('invalid sidecar frame length');
  });
});

describe('writeFrame', () => {
  it('rejects bodies over the frame ceiling', () => {
    const sink = { write: () => true };
    expect(() => writeFrame(sink as never, RESULT, Buffer.alloc(MAX_FRAME_LEN))).toThrow(
      'sidecar frame too large',
    );
  });
});

describe('decodeScreenshotFrame', () => {
  it('splits the request id from the image bytes', () => {
    const id = Buffer.from('r7');
    const body = Buffer.concat([Buffer.from([id.length, 0]), id, Buffer.from([0xff, 0xd8, 0xff])]);
    const decoded = decodeScreenshotFrame(body);
    expect(decoded.requestId).toBe('r7');
    expect([...decoded.image]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('rejects truncated bodies', () => {
    expect(() => decodeScreenshotFrame(Buffer.from([9]))).toThrow('short screenshot frame');
    expect(() => decodeScreenshotFrame(Buffer.from([9, 0, 0x78]))).toThrow('truncated request id');
  });
});

describe('decodeStreamFrame', () => {
  it('splits the udid from the image bytes', () => {
    const udid = Buffer.from('U-1');
    const body = Buffer.concat([
      Buffer.from([udid.length, 0]),
      udid,
      Buffer.from([0xff, 0xd8, 0xff]),
    ]);
    const decoded = decodeStreamFrame(body);
    expect(decoded.udid).toBe('U-1');
    expect([...decoded.image]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('rejects truncated bodies', () => {
    expect(() => decodeStreamFrame(Buffer.from([9]))).toThrow('short stream frame');
    expect(() => decodeStreamFrame(Buffer.from([9, 0, 0x78]))).toThrow('truncated stream udid');
  });
});
