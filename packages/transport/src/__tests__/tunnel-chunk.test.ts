import { describe, expect, it } from 'vitest';
import {
  TUNNEL_CHUNK_HEADER_BYTES,
  TUNNEL_CHUNK_PAYLOAD_BYTES,
  TunnelChunkAssembler,
  TunnelChunkEncoder,
} from '../tunnel-chunk';
import { TUNNEL_MAX_FRAME_BYTES } from '../tunnel-protocol';

describe('tunnel chunk codec', () => {
  it('roundtrips a small message in a single frame', () => {
    const encoder = new TunnelChunkEncoder(1);
    const assembler = new TunnelChunkAssembler();
    const json = '{"kind":"ping","文字":"多字节 🚀"}';
    const frames = encoder.encode(json);
    expect(frames).toHaveLength(1);
    expect(assembler.push(frames[0])).toBe(json);
  });

  it('splits a large message under the frame cap and roundtrips it', () => {
    const encoder = new TunnelChunkEncoder(1);
    const assembler = new TunnelChunkAssembler();
    const json = 'x'.repeat(TUNNEL_CHUNK_PAYLOAD_BYTES * 2 + 123);
    const frames = encoder.encode(json);
    expect(frames).toHaveLength(3);
    for (const frame of frames) {
      expect(frame.byteLength).toBeLessThanOrEqual(TUNNEL_MAX_FRAME_BYTES);
      expect(frame.byteLength).toBeLessThanOrEqual(
        TUNNEL_CHUNK_PAYLOAD_BYTES + TUNNEL_CHUNK_HEADER_BYTES,
      );
    }
    expect(assembler.push(frames[0])).toBeNull();
    expect(assembler.push(frames[1])).toBeNull();
    expect(assembler.push(frames[2])).toBe(json);
  });

  it('reassembles interleaved messages from different senders', () => {
    const a = new TunnelChunkEncoder(1);
    const b = new TunnelChunkEncoder(2);
    const assembler = new TunnelChunkAssembler();
    const jsonA = 'a'.repeat(TUNNEL_CHUNK_PAYLOAD_BYTES + 1);
    const jsonB = 'b'.repeat(TUNNEL_CHUNK_PAYLOAD_BYTES + 1);
    const [a0, a1] = a.encode(jsonA);
    const [b0, b1] = b.encode(jsonB);
    expect(assembler.push(a0)).toBeNull();
    expect(assembler.push(b0)).toBeNull();
    expect(assembler.push(b1)).toBe(jsonB);
    expect(assembler.push(a1)).toBe(jsonA);
  });

  it('keeps consecutive messages from one sender apart', () => {
    const encoder = new TunnelChunkEncoder(7);
    const assembler = new TunnelChunkAssembler();
    expect(assembler.push(encoder.encode('first')[0])).toBe('first');
    expect(assembler.push(encoder.encode('second')[0])).toBe('second');
  });

  it('discards malformed frames without throwing', () => {
    const assembler = new TunnelChunkAssembler();
    // Too short to carry a header.
    expect(assembler.push(new ArrayBuffer(4))).toBeNull();
    // Unknown codec version.
    const badVersion = new Uint8Array(TUNNEL_CHUNK_HEADER_BYTES + 1);
    badVersion[0] = 99;
    expect(assembler.push(badVersion.buffer)).toBeNull();
    // index >= total.
    const badIndex = new Uint8Array(TUNNEL_CHUNK_HEADER_BYTES);
    const view = new DataView(badIndex.buffer);
    view.setUint8(0, 1);
    view.setUint16(9, 2, true);
    view.setUint16(11, 1, true);
    expect(assembler.push(badIndex.buffer)).toBeNull();
  });

  it('drops a message whose frames disagree about the chunk count', () => {
    const encoder = new TunnelChunkEncoder(3);
    const assembler = new TunnelChunkAssembler();
    const frames = encoder.encode('x'.repeat(TUNNEL_CHUNK_PAYLOAD_BYTES * 2 + 1));
    expect(frames).toHaveLength(3);
    expect(assembler.push(frames[0])).toBeNull();
    const forged = new Uint8Array(frames[1].slice(0));
    new DataView(forged.buffer).setUint16(11, 5, true);
    expect(assembler.push(forged.buffer)).toBeNull();
    // The whole message is gone; its remaining frame cannot complete it.
    expect(assembler.push(frames[1])).toBeNull();
    expect(assembler.push(frames[2])).toBeNull();
  });

  it('tolerates a duplicated frame', () => {
    const encoder = new TunnelChunkEncoder(4);
    const assembler = new TunnelChunkAssembler();
    const json = 'y'.repeat(TUNNEL_CHUNK_PAYLOAD_BYTES + 1);
    const [f0, f1] = encoder.encode(json);
    expect(assembler.push(f0)).toBeNull();
    expect(assembler.push(f0)).toBeNull();
    expect(assembler.push(f1)).toBe(json);
  });

  it('evicts the oldest partial message when too many senders stall', () => {
    const assembler = new TunnelChunkAssembler();
    const stalled = new TunnelChunkEncoder(1).encode('z'.repeat(TUNNEL_CHUNK_PAYLOAD_BYTES + 1));
    expect(assembler.push(stalled[0])).toBeNull();
    // 64 further partial messages push the first one out of the buffer.
    for (let sender = 2; sender <= 65; sender++) {
      const frames = new TunnelChunkEncoder(sender).encode(
        'z'.repeat(TUNNEL_CHUNK_PAYLOAD_BYTES + 1),
      );
      expect(assembler.push(frames[0])).toBeNull();
    }
    expect(assembler.push(stalled[1])).toBeNull();
  });

  it('reset discards partial messages', () => {
    const encoder = new TunnelChunkEncoder(5);
    const assembler = new TunnelChunkAssembler();
    const [f0, f1] = encoder.encode('q'.repeat(TUNNEL_CHUNK_PAYLOAD_BYTES + 1));
    expect(assembler.push(f0)).toBeNull();
    assembler.reset();
    expect(assembler.push(f1)).toBeNull();
  });
});
