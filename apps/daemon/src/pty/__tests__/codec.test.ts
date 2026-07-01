import { describe, expect, it } from 'vitest';
import {
  decodeDataFrame,
  encodeDataFrame,
  FrameDecoder,
  MAX_FRAME_LEN,
  MAX_TERMINAL_ID_LEN,
  OUTPUT,
} from '../codec';

function frame(type: number, body: Buffer): Buffer {
  const header = Buffer.allocUnsafe(5);
  header.writeUInt32LE(body.length + 1, 0);
  header[4] = type;
  return Buffer.concat([header, body]);
}

describe('pty sidecar codec', () => {
  it('drops partial frames after reset', () => {
    const decoder = new FrameDecoder();
    const partial = Buffer.allocUnsafe(4);
    partial.writeUInt32LE(6, 0);
    expect(decoder.feed(partial)).toEqual([]);

    decoder.reset();

    expect(decoder.feed(frame(OUTPUT, Buffer.from([1])))).toEqual([
      { type: OUTPUT, body: Buffer.from([1]) },
    ]);
  });

  it('rejects invalid frame lengths', () => {
    const zeroLengthFrame = Buffer.alloc(5);
    const oversizedFrame = Buffer.allocUnsafe(5);
    oversizedFrame.writeUInt32LE(MAX_FRAME_LEN + 1, 0);
    oversizedFrame[4] = OUTPUT;

    const decoder = new FrameDecoder();
    expect(() => decoder.feed(zeroLengthFrame)).toThrow('invalid sidecar frame length');
    expect(() => decoder.feed(oversizedFrame)).toThrow('invalid sidecar frame length');
  });

  it('rejects invalid terminal ids and malformed data frames', () => {
    expect(() => encodeDataFrame('', Buffer.from('hello'))).toThrow('invalid terminal id length');
    expect(() =>
      encodeDataFrame('x'.repeat(MAX_TERMINAL_ID_LEN + 1), Buffer.from('hello')),
    ).toThrow('invalid terminal id length');

    expect(() => decodeDataFrame(Buffer.from([1]))).toThrow('short data frame');
    expect(() => decodeDataFrame(Buffer.from([9, 0, 120]))).toThrow('truncated terminal id');
  });
});
