# LinkCode development

This document covers the common local development workflow. For architecture and package boundaries, read [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Prerequisites

> [!NOTE]
> `devenv` is recommended because it pins Node.js 24, pnpm 11, stable Rust, and pre-commit hooks via `prek`. It is not required if your local toolchain already matches those versions.

Without `devenv`, install these tools yourself:

- Node.js 24 or newer
- pnpm 11
- stable Rust with `rustfmt` and Clippy

With `devenv`, enter the pinned environment:

```bash
devenv shell
```

Install JavaScript dependencies through pnpm only:

```bash
pnpm install
```

## Run the app

With `devenv`, start the daemon and desktop app together:

```bash
devenv run app
```

The `app` process first builds the Rust PTY sidecar, then starts the daemon and desktop dev processes in parallel.

Without `devenv`, run the same sequence manually:

```bash
pnpm -F @linkcode/daemon run build:rust
pnpm --filter @linkcode/daemon --filter @linkcode/desktop --parallel dev
```

Run only the daemon:

```bash
devenv run daemon
```

Without `devenv`:

```bash
pnpm -F @linkcode/daemon run build:rust
pnpm -F @linkcode/daemon run dev
```

Run only the desktop app:

```bash
devenv run desktop
```

Without `devenv`:

```bash
pnpm -F @linkcode/desktop run dev
```

## Rust PTY sidecar

The daemon uses the Rust sidecar crate at [`crates/linkcode-pty`](../crates/linkcode-pty). Its protocol is documented in [`crates/linkcode-pty/PROTOCOL.md`](../crates/linkcode-pty/PROTOCOL.md).

Build the sidecar manually:

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

If the daemon cannot start terminals in development, rebuild the sidecar first:

```bash
pnpm -F @linkcode/daemon run build:rust
```

## Common checks

Run the full JavaScript check set:

```bash
pnpm check:ci
```

Run Rust checks for the sidecar:

```bash
cargo fmt --check
cargo clippy -p linkcode-pty --all-targets -- -D warnings
cargo test -p linkcode-pty --locked
```

Run focused daemon PTY tests:

```bash
pnpm vitest run apps/daemon/src/pty/__tests__/codec.test.ts apps/daemon/src/pty/__tests__/sidecar.test.ts
```

## Formatting and linting

JavaScript and TypeScript use ESLint for linting and Biome for formatting:

```bash
pnpm lint
pnpm format:check
```

Apply automatic formatting and import fixes:

```bash
pnpm format
pnpm lint:fix
```

Rust uses `rustfmt` and Clippy:

```bash
cargo fmt
cargo clippy -p linkcode-pty --all-targets -- -D warnings
```

## Notes

- Use `pnpm`, not `npm` or `npx`.
- The daemon inherits sidecar diagnostics from stderr; protocol data must stay on stdin/stdout.
- The release sidecar is used in development so the daemon's fallback path matches the build script.
