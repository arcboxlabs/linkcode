# linkcode-pty

`linkcode-pty` is the Rust PTY sidecar used by the LinkCode daemon. The daemon starts one long-lived sidecar process and multiplexes terminal sessions over a framed stdin/stdout protocol.

The sidecar owns OS PTYs and process lifecycle; the daemon owns higher-level terminal state, UTF-8 decoding, and client wire messages.

## Build

Build the release sidecar through the daemon package script:

```bash
pnpm -F @linkcode/daemon run build:rust
```

This runs:

```bash
cargo build -p linkcode-pty --release
```

The daemon resolves the sidecar in this order:

1. `LINKCODE_PTY_SIDECAR_PATH`, when set.
2. `target/release/linkcode-pty` under the repository root.

On Windows, the binary name is `linkcode-pty.exe`.

## Protocol

See [`PROTOCOL.md`](./PROTOCOL.md).

In short:

- control frames use small JSON bodies;
- `INPUT` and `OUTPUT` carry raw bytes in binary data frames;
- stderr is reserved for diagnostics and must not carry protocol data.

Control frames are low-frequency and small, so JSON keeps debugging and cross-language parsing simple. PTY input/output is the hot path and carries raw bytes in binary data frames, avoiding base64 and preserving arbitrary terminal byte sequences.

## Benchmark

Run the PTY throughput benchmark from the repository root:

```bash
pnpm -F @linkcode/daemon run bench:pty
```

The benchmark always measures `linkcode-pty`. If `node-pty` is installed locally, it also runs a best-effort comparison against `node-pty`.

Tune payload and sample count with environment variables:

```bash
LINKCODE_PTY_BENCH_BYTES=16777216 LINKCODE_PTY_BENCH_RUNS=10 pnpm -F @linkcode/daemon run bench:pty
```

### Temporary node-pty comparison

This benchmark measures bulk PTY output throughput until the child process exits. It does not measure interactive input latency, resize latency, spawn-only latency, terminal rendering, or long-running terminal behavior. The workload favors raw output throughput and may not reflect workloads dominated by user input, terminal UI rendering, or application-level parsing.

Command shape for one payload size:

```bash
LINKCODE_PTY_BENCH_BYTES=8388608 LINKCODE_PTY_BENCH_RUNS=5 LINKCODE_PTY_BENCH_WARMUP_RUNS=1 pnpm -F @linkcode/daemon run bench:pty
```

On 2026-07-01, a local macOS arm64 / Node 24.14.1 micro-benchmark compared `linkcode-pty` with `node-pty@1.1.0`. `node-pty` was installed outside the repository in a temporary directory so the workspace dependencies stayed unchanged. Its initial prebuild loaded but could not spawn a process under the local Node/devenv setup, so the recorded `node-pty` numbers are from a source rebuild:

```bash
npm_config_build_from_source=true pnpm rebuild node-pty
```

The benchmark used 2 warmup runs and 7 measured runs per payload size:

| Size | Backend | Min | Median | Mean | Max | Throughput | Samples |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 MiB | `linkcode-pty` | `30.3 ms` | `31.1 ms` | `31.7 ms` | `33.6 ms` | `32.2 MiB/s` | `33.6, 33.0, 33.0, 30.9, 30.3, 30.3, 31.1 ms` |
| 1 MiB | `node-pty@1.1.0` | `34.4 ms` | `35.0 ms` | `34.9 ms` | `35.7 ms` | `28.6 MiB/s` | `34.4, 35.7, 34.8, 35.1, 35.1, 34.4, 35.0 ms` |
| 4 MiB | `linkcode-pty` | `49.2 ms` | `50.4 ms` | `50.6 ms` | `53.5 ms` | `79.3 MiB/s` | `50.4, 53.5, 50.4, 49.4, 50.6, 50.7, 49.2 ms` |
| 4 MiB | `node-pty@1.1.0` | `56.6 ms` | `58.0 ms` | `58.0 ms` | `59.2 ms` | `69.0 MiB/s` | `57.5, 56.6, 57.7, 58.0, 58.9, 58.0, 59.2 ms` |
| 8 MiB | `linkcode-pty` | `75.1 ms` | `75.6 ms` | `76.4 ms` | `79.3 ms` | `105.8 MiB/s` | `77.4, 77.2, 75.1, 79.3, 75.1, 75.3, 75.6 ms` |
| 8 MiB | `node-pty@1.1.0` | `89.3 ms` | `89.6 ms` | `89.6 ms` | `89.9 ms` | `89.3 MiB/s` | `89.5, 89.6, 89.9, 89.6, 89.6, 89.3, 89.5 ms` |
| 16 MiB | `linkcode-pty` | `122.7 ms` | `124.3 ms` | `126.0 ms` | `133.5 ms` | `128.8 MiB/s` | `122.7, 122.7, 133.5, 128.5, 124.3, 123.4, 126.5 ms` |
| 16 MiB | `node-pty@1.1.0` | `151.1 ms` | `152.3 ms` | `152.5 ms` | `153.8 ms` | `105.1 MiB/s` | `153.1, 151.1, 152.3, 153.8, 153.4, 151.9, 151.6 ms` |
| 32 MiB | `linkcode-pty` | `218.9 ms` | `219.5 ms` | `221.2 ms` | `227.2 ms` | `145.8 MiB/s` | `227.2, 220.1, 219.4, 218.9, 219.1, 224.4, 219.5 ms` |
| 32 MiB | `node-pty@1.1.0` | `275.7 ms` | `276.3 ms` | `276.5 ms` | `277.4 ms` | `115.8 MiB/s` | `275.9, 277.4, 276.2, 277.2, 275.7, 276.6, 276.3 ms` |
| 64 MiB | `linkcode-pty` | `410.1 ms` | `415.6 ms` | `417.1 ms` | `424.3 ms` | `154.0 MiB/s` | `415.0, 424.0, 415.6, 417.1, 413.9, 410.1, 424.3 ms` |
| 64 MiB | `node-pty@1.1.0` | `521.4 ms` | `524.3 ms` | `524.7 ms` | `530.6 ms` | `122.1 MiB/s` | `527.0, 524.3, 521.5, 521.4, 530.6, 525.7, 522.2 ms` |

Summary by median:

| Size | Faster backend | Median delta |
| ---: | --- | ---: |
| 1 MiB | `linkcode-pty` | ~13% faster |
| 4 MiB | `linkcode-pty` | ~15% faster |
| 8 MiB | `linkcode-pty` | ~19% faster |
| 16 MiB | `linkcode-pty` | ~23% faster |
| 32 MiB | `linkcode-pty` | ~26% faster |
| 64 MiB | `linkcode-pty` | ~26% faster |

Results vary by payload size and system conditions. This benchmark is useful for spotting regressions and checking rough throughput order-of-magnitude, not for claiming a universal winner.

## Checks

```bash
cargo fmt --check
cargo clippy -p linkcode-pty --all-targets -- -D warnings
cargo test -p linkcode-pty --locked
```
