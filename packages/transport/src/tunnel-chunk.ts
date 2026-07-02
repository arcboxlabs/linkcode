import { TUNNEL_MAX_FRAME_BYTES } from './tunnel-protocol';

/**
 * Binary chunk framing for messages crossing the HQ tunnel.
 *
 * Vendored from linkcodehq `packages/tunnel` (chunk.ts) until
 * `@linkcodehq/tunnel` ships on npm; the dependency then replaces this file.
 * Do not diverge from the upstream copy.
 *
 * workerd caps a WebSocket message at {@link TUNNEL_MAX_FRAME_BYTES} and the
 * relay forwards frames verbatim, so the tunnel transport splits each
 * serialized WireMessage into binary frames under the cap and reassembles on
 * the far side. The relay merges every client onto the host's single socket,
 * so frames from different senders can interleave mid-message — each frame
 * therefore carries its sender's random connection id.
 *
 * Frame layout (little-endian):
 *   u8  version  — {@link TUNNEL_CHUNK_VERSION}
 *   u32 sender   — random per transport connection
 *   u32 seq      — per-sender message counter
 *   u16 index    — chunk index within the message
 *   u16 total    — chunk count of the message
 *   …   payload  — UTF-8 slice of the JSON WireMessage
 */

export const TUNNEL_CHUNK_VERSION = 1;
export const TUNNEL_CHUNK_HEADER_BYTES = 13;
/** Payload bytes per frame — ample headroom under the 1 MiB frame cap. */
export const TUNNEL_CHUNK_PAYLOAD_BYTES = 768 * 1024;

/** Reassembly buffer caps: beyond these the oldest partial message is dropped. */
const MAX_PENDING_MESSAGES = 64;
const MAX_PENDING_BYTES = 64 * 1024 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class TunnelChunkEncoder {
  private seq = 0;

  constructor(private readonly sender: number = Math.floor(Math.random() * 0x1_00_00_00_00)) {}

  /** Split one serialized WireMessage into ready-to-send binary frames. */
  encode(json: string): ArrayBuffer[] {
    const bytes = encoder.encode(json);
    const total = Math.max(1, Math.ceil(bytes.length / TUNNEL_CHUNK_PAYLOAD_BYTES));
    // biome-ignore format: hex casing is owned by eslint (unicorn/number-literal-case)
    if (total > 0xFFFF) {
      throw new Error(`TunnelChunkEncoder: message too large (${bytes.length} bytes)`);
    }
    const seq = this.seq++;
    const frames: ArrayBuffer[] = [];
    for (let index = 0; index < total; index++) {
      const payload = bytes.subarray(
        index * TUNNEL_CHUNK_PAYLOAD_BYTES,
        (index + 1) * TUNNEL_CHUNK_PAYLOAD_BYTES,
      );
      const frame = new Uint8Array(TUNNEL_CHUNK_HEADER_BYTES + payload.length);
      const view = new DataView(frame.buffer);
      view.setUint8(0, TUNNEL_CHUNK_VERSION);
      view.setUint32(1, this.sender, true);
      view.setUint32(5, seq, true);
      view.setUint16(9, index, true);
      view.setUint16(11, total, true);
      frame.set(payload, TUNNEL_CHUNK_HEADER_BYTES);
      frames.push(frame.buffer);
    }
    return frames;
  }
}

interface PendingMessage {
  chunks: Array<Uint8Array | undefined>;
  received: number;
  bytes: number;
}

export class TunnelChunkAssembler {
  /** Keyed `sender:seq`; Map iteration order doubles as insertion-ordered eviction. */
  private readonly pending = new Map<string, PendingMessage>();
  private pendingBytes = 0;

  /**
   * Feed one inbound binary frame; returns the reassembled JSON string when it
   * completes a message, null otherwise. Malformed frames are discarded — the
   * relay only ever carries frames produced by this codec, so anything else is
   * a version skew and the sender's whole message is unrecoverable anyway.
   */
  push(data: ArrayBufferLike): string | null {
    if (data.byteLength < TUNNEL_CHUNK_HEADER_BYTES || data.byteLength > TUNNEL_MAX_FRAME_BYTES) {
      return null;
    }
    const view = new DataView(data);
    if (view.getUint8(0) !== TUNNEL_CHUNK_VERSION) return null;
    const sender = view.getUint32(1, true);
    const seq = view.getUint32(5, true);
    const index = view.getUint16(9, true);
    const total = view.getUint16(11, true);
    if (total === 0 || index >= total) return null;
    const payload = new Uint8Array(data, TUNNEL_CHUNK_HEADER_BYTES);

    if (total === 1) return decoder.decode(payload);

    const key = `${sender}:${seq}`;
    let entry = this.pending.get(key);
    if (!entry) {
      entry = { chunks: new Array<Uint8Array | undefined>(total), received: 0, bytes: 0 };
      this.pending.set(key, entry);
    } else if (entry.chunks.length !== total) {
      // A frame disagreeing with its siblings about the chunk count — drop the message.
      this.drop(key, entry);
      return null;
    }
    const previous = entry.chunks[index];
    if (previous) {
      entry.bytes -= previous.length;
      this.pendingBytes -= previous.length;
    } else {
      entry.received += 1;
    }
    entry.chunks[index] = payload;
    entry.bytes += payload.length;
    this.pendingBytes += payload.length;

    if (entry.received < total) {
      this.evictOverflow();
      return null;
    }
    this.drop(key, entry);
    const whole = new Uint8Array(entry.bytes);
    let offset = 0;
    for (const chunk of entry.chunks) {
      // received === total guarantees every slot is filled.
      if (!chunk) return null;
      whole.set(chunk, offset);
      offset += chunk.length;
    }
    return decoder.decode(whole);
  }

  /** Discard all partial messages (call when the underlying socket closes). */
  reset(): void {
    this.pending.clear();
    this.pendingBytes = 0;
  }

  private drop(key: string, entry: PendingMessage): void {
    this.pendingBytes -= entry.bytes;
    this.pending.delete(key);
  }

  /**
   * A sender that vanished mid-message leaks its partial buffer; cap the
   * damage. Evicting a still-active message is safe — its remaining chunks
   * re-create an entry that can never complete and is evicted in turn.
   */
  private evictOverflow(): void {
    while (this.pending.size > MAX_PENDING_MESSAGES || this.pendingBytes > MAX_PENDING_BYTES) {
      const oldest = this.pending.entries().next().value;
      if (!oldest) break;
      this.drop(oldest[0], oldest[1]);
    }
  }
}
