# linkcode-sim

The Link Code iOS Simulator host: one long-lived process the daemon spawns to drive Apple's iOS Simulator. P0 wraps the public `xcrun simctl` CLI only (lifecycle, install/launch, screenshot); the streaming/HID phase is CODE-396. The stdio wire contract is [`PROTOCOL.md`](./PROTOCOL.md); the TypeScript client is `@linkcode/sim` (`packages/host/sim`).

macOS-only at runtime (it needs Xcode's simulator tooling); it compiles and answers `probe` with a structured `xcodeMissing` error everywhere else, so workspace-wide `cargo test` stays green on any platform.

## Development

```sh
cargo test -p linkcode-sim                                  # unit + protocol smoke tests
cargo test -p linkcode-sim --test device_loop -- --ignored  # full boot→install→launch→screenshot loop (needs Xcode, boots a simulator)
```

Release binaries are staged by `apps/desktop/scripts/stage-sidecar.mts` into `apps/desktop/sidecar/${arch}` (macOS only) and shipped via electron-builder `extraResources`.
