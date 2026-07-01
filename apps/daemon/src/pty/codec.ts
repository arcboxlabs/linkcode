import type { Writable } from 'node:stream';

/**
 * Daemon side of the sidecar stdio protocol (mirrors `crates/linkcode-pty/src/proto.rs`).
 * Frame layout: `[u32 LE total][u8 type][body]`, where `total = 1 + body.length`.
 */

// Daemon → sidecar.
export const OPEN = 0x01;
export const INPUT = 0x02;
export const RESIZE = 0x03;
export const CLOSE = 0x04;
// Sidecar → daemon.
export const OPENED = 0x81;
export const OUTPUT = 0x82;
export const EXIT = 0x83;
export const ERROR = 0x84;

export const MAX_FRAME_LEN = 16 * 1024 * 1024;
export const MAX_TERMINAL_ID_LEN = 65535;

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

/** Encode a data-frame body: `[u16 LE id_len][id][data]`. */
export function encodeDataFrame(terminalId: string, data: Buffer): Buffer {
  const id = Buffer.from(terminalId, 'utf8');
  if (id.length === 0 || id.length > MAX_TERMINAL_ID_LEN) {
    throw new Error(`invalid terminal id length: ${id.length}`);
  }
  const out = Buffer.allocUnsafe(2 + id.length + data.length);
  out.writeUInt16LE(id.length, 0);
  id.copy(out, 2);
  data.copy(out, 2 + id.length);
  return out;
}

export function decodeDataFrame(body: Buffer): { terminalId: string; data: Buffer } {
  if (body.length < 2) throw new Error('short data frame');
  const idLen = body.readUInt16LE(0);
  if (body.length < 2 + idLen) throw new Error('truncated terminal id');
  return {
    terminalId: body.subarray(2, 2 + idLen).toString('utf8'),
    data: body.subarray(2 + idLen),
  };
}
