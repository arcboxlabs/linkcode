import type { Writable } from 'node:stream';

/**
 * TypeScript side of the sim sidecar stdio protocol (mirrors `crates/linkcode-sim/src/proto.rs`;
 * contract in `crates/linkcode-sim/PROTOCOL.md`). Frame layout: `[u32 LE total][u8 type][body]`,
 * where `total = 1 + body.length`.
 */

// Daemon → sidecar.
export const REQUEST = 0x01;
// Sidecar → daemon.
export const RESULT = 0x81;
export const SCREENSHOT = 0x82;
/** Unsolicited JPEG frame pushed while a `streamStart` stream runs. */
export const STREAM_FRAME = 0x83;
/** Unsolicited H.264 access unit (Annex-B) pushed while an h264 stream runs. */
export const STREAM_FRAME_H264 = 0x84;

export const MAX_FRAME_LEN = 16 * 1024 * 1024;

export interface Frame {
  type: number;
  body: Buffer;
}

/** Reassembles length-prefixed frames from an arbitrarily-chunked byte stream. */
export class FrameDecoder {
  private carry: Buffer = Buffer.alloc(0);

  reset(): void {
    this.carry = Buffer.alloc(0);
  }

  feed(chunk: Buffer): Frame[] {
    this.carry = this.carry.length === 0 ? chunk : Buffer.concat([this.carry, chunk]);
    const frames: Frame[] = [];
    while (this.carry.length >= 5) {
      const total = this.carry.readUInt32LE(0);
      if (total === 0 || total > MAX_FRAME_LEN) {
        throw new Error(`invalid sidecar frame length: ${total}`);
      }
      if (this.carry.length < 4 + total) break;
      const type = this.carry[4];
      frames.push({ type, body: Buffer.from(this.carry.subarray(5, 4 + total)) });
      this.carry = this.carry.subarray(4 + total);
    }
    // Copy the remainder off the (possibly large) concatenated buffer so it can be released.
    this.carry = Buffer.from(this.carry);
    return frames;
  }
}

export function writeFrame(sink: Writable, type: number, body: Buffer): void {
  if (body.length + 1 > MAX_FRAME_LEN) {
    throw new Error(`sidecar frame too large: ${body.length + 1}`);
  }
  const header = Buffer.allocUnsafe(5);
  header.writeUInt32LE(body.length + 1, 0);
  header[4] = type;
  sink.write(Buffer.concat([header, body]));
}

/** Decode a `SCREENSHOT` body: `[u16 LE id_len][request_id][image bytes]`. */
export function decodeScreenshotFrame(body: Buffer): { requestId: string; image: Buffer } {
  if (body.length < 2) throw new Error('short screenshot frame');
  const idLen = body.readUInt16LE(0);
  if (body.length < 2 + idLen) throw new Error('truncated request id');
  return {
    requestId: body.subarray(2, 2 + idLen).toString('utf8'),
    image: body.subarray(2 + idLen),
  };
}

/** Decode a `STREAM_FRAME` body: `[u16 LE udid_len][udid][image bytes]`. */
export function decodeStreamFrame(body: Buffer): { udid: string; image: Buffer } {
  if (body.length < 2) throw new Error('short stream frame');
  const udidLen = body.readUInt16LE(0);
  if (body.length < 2 + udidLen) throw new Error('truncated stream udid');
  return {
    udid: body.subarray(2, 2 + udidLen).toString('utf8'),
    image: body.subarray(2 + udidLen),
  };
}

/** Decode a `STREAM_FRAME_H264` body: `[u16 LE udid_len][udid][u8 key][Annex-B access unit]`. */
export function decodeStreamFrameH264(body: Buffer): { udid: string; key: boolean; data: Buffer } {
  if (body.length < 3) throw new Error('short h264 stream frame');
  const udidLen = body.readUInt16LE(0);
  if (body.length < 3 + udidLen) throw new Error('truncated h264 stream udid');
  return {
    udid: body.subarray(2, 2 + udidLen).toString('utf8'),
    key: body[2 + udidLen] === 1,
    data: body.subarray(3 + udidLen),
  };
}
