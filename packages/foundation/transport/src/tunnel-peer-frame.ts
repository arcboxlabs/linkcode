import { TUNNEL_MAX_FRAME_BYTES } from '@linkcode/tunnel';

export type TunnelPeerFrame =
  | { readonly kind: 'peer.join'; readonly peerId: string }
  | { readonly kind: 'peer.leave'; readonly peerId: string }
  | {
      readonly kind: 'peer.data';
      readonly peerId: string;
      readonly data: string | ArrayBuffer;
    };

type TunnelPeerFrameInput =
  | Exclude<TunnelPeerFrame, { readonly kind: 'peer.data' }>
  | {
      readonly kind: 'peer.data';
      readonly peerId: string;
      readonly data: string | ArrayBuffer | ArrayBufferView;
    };

const PEER_FRAME_VERSION = 1;
const PEER_FRAME_HEADER_BYTES = 4;
const PEER_ID_MAX_BYTES = 256;

const FrameKind = {
  Join: 1,
  Leave: 2,
  BinaryData: 3,
  TextData: 4,
} as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function encodeTunnelPeerFrame(frame: TunnelPeerFrameInput): ArrayBuffer {
  const peerId = encoder.encode(frame.peerId);
  if (peerId.length === 0 || peerId.length > PEER_ID_MAX_BYTES) {
    throw new Error('Tunnel peer id must be 1–256 UTF-8 bytes');
  }

  let kind: number;
  let payload: Uint8Array = new Uint8Array();
  if (frame.kind === 'peer.join') kind = FrameKind.Join;
  else if (frame.kind === 'peer.leave') kind = FrameKind.Leave;
  else if (typeof frame.data === 'string') {
    kind = FrameKind.TextData;
    payload = encoder.encode(frame.data);
  } else if (frame.data instanceof ArrayBuffer) {
    kind = FrameKind.BinaryData;
    payload = new Uint8Array(frame.data);
  } else {
    kind = FrameKind.BinaryData;
    payload = new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
  }

  const size = PEER_FRAME_HEADER_BYTES + peerId.length + payload.length;
  if (size > TUNNEL_MAX_FRAME_BYTES) {
    throw new Error(`Tunnel peer frame too large (${size} bytes)`);
  }
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, PEER_FRAME_VERSION);
  view.setUint8(1, kind);
  view.setUint16(2, peerId.length, true);
  bytes.set(peerId, PEER_FRAME_HEADER_BYTES);
  bytes.set(payload, PEER_FRAME_HEADER_BYTES + peerId.length);
  return bytes.buffer;
}

export function decodeTunnelPeerFrame(
  input: ArrayBuffer | ArrayBufferView,
): TunnelPeerFrame | null {
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.length < PEER_FRAME_HEADER_BYTES || bytes.length > TUNNEL_MAX_FRAME_BYTES) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== PEER_FRAME_VERSION) return null;
  const kind = view.getUint8(1);
  const peerIdLength = view.getUint16(2, true);
  if (
    peerIdLength === 0 ||
    peerIdLength > PEER_ID_MAX_BYTES ||
    PEER_FRAME_HEADER_BYTES + peerIdLength > bytes.length
  ) {
    return null;
  }

  let peerId: string;
  try {
    peerId = decoder.decode(
      bytes.subarray(PEER_FRAME_HEADER_BYTES, PEER_FRAME_HEADER_BYTES + peerIdLength),
    );
  } catch {
    return null;
  }
  const payload = bytes.subarray(PEER_FRAME_HEADER_BYTES + peerIdLength);
  if (kind === FrameKind.Join && payload.length === 0) {
    return { kind: 'peer.join', peerId };
  }
  if (kind === FrameKind.Leave && payload.length === 0) {
    return { kind: 'peer.leave', peerId };
  }
  if (kind === FrameKind.BinaryData) {
    return { kind: 'peer.data', peerId, data: payload.slice().buffer };
  }
  if (kind === FrameKind.TextData) {
    try {
      return { kind: 'peer.data', peerId, data: decoder.decode(payload) };
    } catch {
      return null;
    }
  }
  return null;
}
