# linkcode-sim

The Link Code iOS Simulator host: one long-lived process the daemon spawns to drive Apple's iOS Simulator. P0 wraps the public `xcrun simctl` CLI (lifecycle, install/launch, screenshot); P1 adds live framebuffer streaming (JPEG `STREAM_FRAME`s) and touch/button injection through CoreSimulator/SimulatorKit private frameworks, in a crash-isolated capture worker. The stdio wire contract is [`PROTOCOL.md`](./PROTOCOL.md); the TypeScript client is `@linkcode/sim` (`packages/host/sim`).

macOS-only at runtime (it needs Xcode's simulator tooling); it compiles and answers `probe` with a structured `xcodeMissing` error everywhere else, so workspace-wide `cargo test` stays green on any platform.

## Development

```sh
cargo test -p linkcode-sim                                  # unit + protocol smoke tests
cargo test -p linkcode-sim --test device_loop -- --ignored  # full boot→install→launch→screenshot loop (needs Xcode, boots a simulator)
```

Release binaries are staged by `apps/desktop/scripts/stage-sidecar.mts` into `apps/desktop/sidecar/${arch}` (macOS only) and shipped via electron-builder `extraResources`.

## Benchmark

`bench-encode` times the JPEG encode hot path — the per-frame CoreGraphics/ImageIO cost that bounds the framebuffer stream, since a single reader thread does the encode. `1000 / avg_ms` is the sustainable frame-rate ceiling. It needs no simulator: it encodes a synthetic BGRA frame across a resolution/quality sweep.

```sh
cargo build -p linkcode-sim --release
./target/release/linkcode-sim bench-encode [iters]   # default 120 iters/config
```

On 2026-07-22 (macOS arm64), 150 iters/config:

| Resolution | Quality | avg ms | p95 ms | Size | fps (avg) | fps (peak) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1206×2622 (native) | 0.60 | 6.49 | 8.13 | 705K | 154 | 182 |
| 904×1966 | 0.60 | 3.45 | 3.98 | 396K | 290 | 332 |
| 603×1311 | 0.60 | 1.50 | 1.73 | 177K | 665 | 730 |
| 402×874 | 0.60 | 0.77 | 0.95 | 79K | 1294 | 1441 |
| 1206×2622 | 0.30 | 6.39 | 7.74 | 705K | 156 | 181 |

Takeaways: the native-resolution encode ceiling (~154 fps) leaves ~2.5× headroom over 60 fps; cost is set by pixel count (the DCT), not JPEG quality (0.3 ≈ 0.6); downscaling is the real lever (half resolution ≈ 4× cheaper). The synthetic frame is high-entropy, so the numbers are conservative — a mostly-flat real screen encodes a touch faster. Use it to catch encode regressions and size the fps/resolution budget, not as an absolute.
