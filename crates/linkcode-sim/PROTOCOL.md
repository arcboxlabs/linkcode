# LinkCode iOS Simulator sidecar protocol

Private stdin/stdout IPC protocol for `linkcode-sim`. For build and development notes, see [`README.md`](./README.md).

The Rust implementation is in [`src/proto.rs`](src/proto.rs) and [`src/rpc.rs`](src/rpc.rs); the TypeScript counterpart lives in `@linkcode/sim` (`packages/host/sim`, CODE-393). Stderr is reserved for diagnostics and must not carry protocol data.

## Transport

Identical framing to `linkcode-pty`: each frame has a 5-byte header followed by a body:

```text
[u32 little-endian total][u8 type][body]
```

`total = 1 + body.length`, must be non-zero and at most `16 MiB`. Multi-byte integers are little-endian. If frame decoding fails, the stream is considered corrupt — the receiver should stop using that sidecar instance instead of resynchronizing mid-stream.

## Frame types

Daemon to sidecar:

| Type | Name | Body |
| ---: | --- | --- |
| `0x01` | `REQUEST` | JSON [`Request`](#request) |

Sidecar to daemon:

| Type | Name | Body |
| ---: | --- | --- |
| `0x81` | `RESULT` | JSON [`Result`](#result) |
| `0x82` | `SCREENSHOT` | binary [`Screenshot body`](#screenshot-body) |
| `0x83` | `STREAM_FRAME` | binary [`Stream frame body`](#stream-frame-body) (unsolicited, while a stream runs) |

Unknown frame types are ignored. A malformed `REQUEST` fails only that request — the sidecar replies with an `invalidRequest` `RESULT` for its `requestId` and keeps serving. If the `requestId` itself cannot be recovered, the sidecar logs to stderr and the daemon's pending request is reclaimed by its own timeout.

## Request

```json
{
  "requestId": "r-1",
  "op": { "type": "boot", "udid": "615920B7-…" }
}
```

`requestId` is daemon-generated, non-empty UTF-8, max `65535` bytes, and unique among in-flight requests. Each request runs on its own sidecar thread: a slow `boot` never delays a concurrent `screenshot`, and responses arrive in completion order, not request order.

### Ops (P0 — everything shells out to `xcrun simctl`)

| `type` | Params | Result |
| --- | --- | --- |
| `probe` | — | `{ simctlPath, developerDir }` |
| `list` | — | `{ devices: [{ udid, name, state, runtime, runtimeName?, deviceType }] }` |
| `boot` | `udid` | `{}` — waits for full boot (`bootstatus -b`); already-booted succeeds |
| `shutdown` | `udid` | `{}` — already-shutdown succeeds |
| `install` | `udid`, `appPath` | `{}` |
| `launch` | `udid`, `bundleId` | `{ pid }` (`pid` is `null` if simctl's output had no parsable pid) |
| `terminate` | `udid`, `bundleId` | `{}` |
| `openUrl` | `udid`, `url` | `{}` |
| `screenshot` | `udid`, `format?` (`jpeg` default, `png`) | bytes on a [`SCREENSHOT`](#screenshot-body) frame |
| `screenMask` | `udid` | transparent PNG bytes on a [`SCREENSHOT`](#screenshot-body) frame |

`screenMask` rasterizes the devicetype bundle's `framebufferMask` PDF — the exact screen outline (corner curvature, sensor island) at the device's native pixel size — so clients can clip the framebuffer to the real device shape. Resolved at runtime from the local Xcode install (`simctl list devicetypes` → `bundlePath`); nothing Apple-owned ships with Link Code. Devicetypes without a mask (and non-macOS hosts) fail with a normal `RESULT` error and clients fall back to a generic rounding.

Per-op deadlines are enforced sidecar-side (`boot` 180s, `install` 120s, `screenshot` 30s, others 60s); a child that outlives its deadline is killed and reported as `timeout`.

`probe` additionally reports `interactive: bool` — whether this host can drive simulators through the private-API path below (macOS with SimulatorKit). The daemon gates the interactive ops on it.

### Ops (P1 — private API: HID injection + framebuffer streaming, macOS only)

Off macOS, or when SimulatorKit is unavailable, every P1 op fails with `xcodeMissing`.

| `type` | Params | Result |
| --- | --- | --- |
| `tap` | `udid`, `x`, `y` (normalised 0..1) | `{}` |
| `touch` | `udid`, `phase` (`down`/`move`/`up`), `x`, `y` | `{}` — one phase of a caller-driven touch stream |
| `swipe` | `udid`, `x0`, `y0`, `x1`, `y1`, `durationMs?` | `{}` |
| `button` | `udid`, `button` (`home`/`lock`) | `{}` |
| `key` | `udid`, `usage` (HID page-7 usage), `modifiers?` (usages `0xE0..`) | `{}` — modifier-downs → key-down → key-up → modifier-ups |
| `streamStart` | `udid`, `fps?` (60), `quality?` (0.6), `scale?` (1.0), `codec?` (`jpeg` default, `h264`) | `{ streaming, fps, scale, codec }` — frames then arrive on `STREAM_FRAME`s (jpeg) or `STREAM_FRAME_H264`s |
| `streamStop` | `udid` | `{}` |

`touch` streams a gesture in real time (the client forwards pointer events, so the device sees the finger during a drag — long-press, rubber-banding, icon drags all come from the device's own gesture recognition). The sidecar tracks one active touch identifier per udid (`down` allocates, `up` releases; a `move`/`up` without one no-ops). `touch` and `key` requests are handled **inline on the read loop** — never on a per-request thread — so phases and keystrokes keep stdio order.

`scale` (0.1..1.0) downscales each frame before JPEG encode: at native resolution the encode bounds the frame rate near ~55 fps, so `scale` below 1.0 both lifts the achievable rate toward the display's 60 Hz and cuts bandwidth (e.g. `0.5` ≈ one third the bytes). `tap`/`swipe` stay in normalized 0..1 coordinates, so a downscaled stream needs no coordinate adjustment.

`codec: h264` switches the stream to hardware H.264 (VideoToolbox): the retained framebuffer `IOSurface` is wrapped in a `CVPixelBuffer` and encoded on the media engine — pixels never enter CPU memory — at **native resolution** (`scale`/`quality` are ignored; bitrate carries the bandwidth budget, ~10-25× below the JPEG stream). Access units are Annex-B with SPS/PPS prepended on keyframes (≤2s apart) — exactly what a WebCodecs `VideoDecoder` configured without a `description` consumes. Delivery is **ordered and lossless** (deltas depend on each other); if the sidecar must drop (stalled consumer), it drops through the next keyframe. If the private worker gives up, the stream degrades to slow simctl JPEG `STREAM_FRAME`s — each wire frame declares its own encoding, so a mixed stream stays decodable.

### `STREAM_FRAME_H264` body (`0x84`)

`[u16 LE udid_len][udid][u8 key][Annex-B access unit]` — `key` is `1` on sync frames.

Input (`tap`/`swipe`/`button`) runs in the sidecar's main process via a per-udid warmed HID client and is stable. Framebuffer streaming runs in a **crash-isolated worker subprocess**: the sidecar spawns it, reads its frames, and respawns it on the intermittent hard crashes of the private framebuffer path. If the worker crash-loops and gives up, the stream degrades to `simctl io screenshot` frames — slower, but frames never stop and the sidecar never crashes.

## Result

Success:

```json
{ "requestId": "r-1", "ok": true, "result": {} }
```

Failure:

```json
{ "requestId": "r-1", "ok": false, "error": { "code": "xcodeMissing", "message": "…" } }
```

Error codes:

| Code | Meaning |
| --- | --- |
| `xcodeMissing` | `xcrun`/simctl not found — Xcode (with the iOS platform) is not installed or not selected. The daemon should gate the simulator capability on this, not retry. |
| `simctlFailed` | simctl ran and reported failure; `message` carries its stderr. |
| `timeout` | The operation's deadline elapsed. |
| `invalidRequest` | The request body could not be parsed. |
| `io` | Spawning simctl or reading its output failed at the OS level. |

## Screenshot body

A successful `screenshot` responds with raw image bytes instead of JSON, so captures never pay base64 on this private pipe:

```text
[u16 little-endian request_id_length][request_id UTF-8 bytes][image bytes]
```

A failed `screenshot` responds with a normal `RESULT` error. Exactly one of the two arrives per request.

## Stream frame body

While a `streamStart` stream runs, the sidecar pushes unsolicited `STREAM_FRAME`s (raw JPEG bytes, no base64):

```text
[u16 little-endian udid_length][udid UTF-8 bytes][image bytes]
```

Frames stop after `streamStop` (or when the daemon closes the pipe). The daemon routes them by `udid`.

## Lifecycle expectations

- One sidecar process serves many concurrent requests; the daemon lazily starts it on first use.
- When daemon stdin closes, the sidecar stops writing and exits without waiting for in-flight simctl calls — a mid-boot device keeps booting server-side in CoreSimulatorService either way. The daemon owns device cleanup (per-session shutdown, CODE-393).
- If the sidecar exits or its stream becomes corrupt, the daemon rejects pending requests and restarts the sidecar with a fresh frame decoder.
