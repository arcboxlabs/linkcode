/**
 * Framebuffer stream decoder: turns the wire's encoded frames into {@link DecodedFrame}s for the
 * compositor. H.264 access units decode through WebCodecs (hardware, GPU-resident output); JPEG
 * frames decode latest-wins via `createImageBitmap`. Framework-agnostic — the consumer supplies an
 * `onFrame` sink and drives it with {@link SimulatorFrameDecoder.push}.
 */

import { noop } from 'foxts/noop';
import type { DecodedFrame } from './device-compositor';

/** One stream frame: a base64 JPEG image, or one ordered base64 Annex-B H.264 access unit. */
export interface SimulatorScreenFrame {
  codec: 'jpeg' | 'h264';
  key: boolean;
  data: string;
}

/** High profile at a level comfortably above any simulator resolution; the in-band SPS/PPS on
 * each keyframe governs the actual stream parameters. */
const H264_CODEC = 'avc1.640034';

export class SimulatorFrameDecoder {
  private closed = false;

  // JPEG path: latest-wins, one decode in flight.
  private latestJpeg: string | null = null;
  private decoding = false;

  // H.264 path: a lazily-configured decoder that starts from a keyframe and resets on error.
  private decoder: VideoDecoder | null = null;
  private awaitingKey = true;
  private timestamp = 0;

  constructor(private readonly onFrame: (frame: DecodedFrame) => void) {}

  /** Feed one wire frame; decoded output arrives on `onFrame`. */
  push(frame: SimulatorScreenFrame): void {
    if (this.closed) return;
    if (frame.codec === 'h264') {
      this.decodeH264(frame);
      return;
    }
    // A JPEG frame amid an h264 stream means the host degraded; drop the decoder.
    this.resetDecoder();
    this.latestJpeg = frame.data;
    this.drawNextJpeg();
  }

  /** Tear down: closes the H.264 decoder and stops emitting. */
  close(): void {
    this.closed = true;
    this.resetDecoder();
  }

  private emit(frame: DecodedFrame): void {
    if (this.closed) {
      frame.close();
      return;
    }
    this.onFrame(frame);
  }

  private drawNextJpeg(): void {
    if (this.decoding || this.latestJpeg === null || this.closed) return;
    const encoded = this.latestJpeg;
    this.latestJpeg = null;
    this.decoding = true;
    void createImageBitmap(new Blob([base64Bytes(encoded)], { type: 'image/jpeg' }))
      .then((bitmap) => this.emit(bitmap))
      // A corrupt frame is dropped; the next one repaints.
      .catch(noop)
      .finally(() => {
        this.decoding = false;
        this.drawNextJpeg();
      });
  }

  private decodeH264(frame: SimulatorScreenFrame): void {
    if (this.decoder === null) {
      const created = new VideoDecoder({
        output: (decoded) => this.emit(decoded),
        error: () => this.resetDecoder(),
      });
      created.configure({ codec: H264_CODEC, optimizeForLatency: true });
      this.decoder = created;
      this.awaitingKey = true;
    }
    if (this.awaitingKey && !frame.key) return;
    this.awaitingKey = false;
    this.decoder.decode(
      new EncodedVideoChunk({
        type: frame.key ? 'key' : 'delta',
        // Synthetic monotonic clock; frames present as they arrive, so only order matters.
        timestamp: this.timestamp++,
        data: base64Bytes(frame.data),
      }),
    );
  }

  private resetDecoder(): void {
    if (this.decoder !== null && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
    this.awaitingKey = true;
  }
}

/** Decode a base64-encoded PNG screen mask to a bitmap. Takes the raw base64, not a `data:` URL:
 * the desktop renderer's CSP forbids `data:` in `connect-src`, so `fetch()`-ing a data URL is
 * silently blocked — building the Blob from the decoded bytes avoids the network path entirely. */
export function decodeMask(pngBase64: string): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([base64Bytes(pngBase64)], { type: 'image/png' }));
}

function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.codePointAt(index) ?? 0;
  }
  return bytes;
}
