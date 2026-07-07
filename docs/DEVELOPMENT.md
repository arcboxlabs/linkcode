# LinkCode development

The local runbook: run the apps, run the tests, debug a stuck daemon. For architecture and package boundaries read [`ARCHITECTURE.md`](./ARCHITECTURE.md); for engineering discipline read [`../AGENTS.md`](../AGENTS.md).

## Prerequisites

> [!NOTE]
> `devenv` is recommended: it pins Node.js 24, pnpm 11, stable Rust, and the `prek` pre-commit hooks. It is not required if your local toolchain already matches.

Without `devenv`, install these yourself:

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

### Daemon + desktop together

```bash
devenv run app
```

`app` first builds the Rust PTY sidecar, then starts the daemon and desktop dev processes in parallel. Without `devenv`, run the same sequence:

```bash
pnpm -F @linkcode/daemon run build:rust
pnpm --filter @linkcode/daemon --filter @linkcode/desktop --parallel dev
```

Root `pnpm dev` (= `turbo run dev`) is different: it starts **all four** persistent dev servers at once — daemon, desktop, `@linkcode/server`, and webview. Use `-F`/`--filter` to run a subset. `apps/mobile` and the `packages/*` have no `dev` script.

### Daemon only

```bash
devenv run daemon
# without devenv:
pnpm -F @linkcode/daemon run build:rust
pnpm -F @linkcode/daemon run dev
```

### Desktop only

```bash
devenv run desktop
# without devenv:
pnpm -F @linkcode/desktop run dev   # electron-vite dev
```

### Webview (browser renderer)

There is no `devenv` script for the webview. Run it directly:

```bash
pnpm -F @linkcode/webview run dev   # vite
```

### Mobile (Expo, iOS)

```bash
devenv run mobile
# without devenv:
pnpm -F @linkcode/mobile run ios    # expo start --ios
```

## Rust PTY sidecar

The daemon drives terminals through the Rust crate at [`crates/linkcode-pty`](../crates/linkcode-pty); its wire protocol is in [`crates/linkcode-pty/PROTOCOL.md`](../crates/linkcode-pty/PROTOCOL.md). Build it for local dev:

```bash
pnpm -F @linkcode/daemon run build:rust   # cargo build -p linkcode-pty --release
```

The daemon resolves the binary (`resolveSidecarPath`, `apps/daemon/src/pty/sidecar.ts`) in this order:

1. `LINKCODE_PTY_SIDECAR_PATH` — always wins when set.
2. **Dev** (running `.ts` source under tsx): `<repoRoot>/target/release/linkcode-pty` (`linkcode-pty.exe` on Windows).
3. **Prod** (a tsup `.js` bundle can't trust that relative depth): with no override it logs an error and returns `''` — terminals are unconfigured.

The release build is used in dev on purpose, so the daemon's fallback path matches the build script. If terminals fail in dev, rebuild the sidecar first, then see the terminal triage below.

## Testing

### One runner

There is exactly **one** test runner: root `pnpm test` (= `vitest run`), driven by a single root `vitest.config.ts` (`environment: 'node'`; include globs `packages/**/src/**/__tests__/**/*.test.ts` and `apps/**/src/**/__tests__/**/*.test.ts`). No app or package has its own `test` script and `turbo.json` has no `test` task, so `turbo run test` does nothing. All tests are pure-logic node-env — no jsdom/DOM component render; even renderer tests exercise pure store/reducer functions. Run one area by passing a path or name filter:

```bash
pnpm test apps/daemon/src/pty     # just the PTY unit tests
```

### CI does NOT run vitest

CI (`.github/workflows/ci.yml`) has three jobs: **typescript** (`format:check`, `lint`, `typecheck`), **rust** (`cargo fmt --check`, `clippy`, `test`), and an **All Green** aggregate gate over both. None of them runs `pnpm test` — the vitest suite gates nothing in CI, so **run it yourself before every commit**. Do not trust an agent workflow's "all green" self-report: run `pnpm check:ci` and `pnpm test` and re-check anything a review left unfixed. A `tsconfig` that excludes its own test files silently hides test type errors (agent-adapter once hid 6 this way).

Store tests load the `better-sqlite3` native binding (allow-listed under `allowBuilds:` in `pnpm-workspace.yaml`). If that build was skipped, `pnpm test` fails at require time loading the store — a native-binding error, not a test-logic failure.

### PTY test layers

The PTY subsystem has four layers, and the frame protocol is implemented **twice** (Rust `proto.rs`, TS `codec.ts`) — only layers 3–4 catch a mismatch between them:

1. `apps/daemon/src/pty/__tests__/codec.test.ts` — pure TS frame codec.
2. `apps/daemon/src/pty/__tests__/sidecar.test.ts` — `SidecarPtyBackend` with `vi.mock('node:child_process')`; no real binary.
3. `apps/daemon/src/pty/__tests__/sidecar.integration.test.ts` — real backend against the real compiled `linkcode-pty` (cross-boundary wire check).
4. `crates/linkcode-pty/tests/smoke.rs` — Rust, unix-only, self-builds via `CARGO_BIN_EXE_linkcode-pty`.

**Silent-skip trap:** layer 3 is `describe.skipIf(!BINARY)` and **silently skips** when `linkcode-pty` isn't built (it looks for `target/debug` then `target/release`, first existing wins, else skip). Plain `pnpm test` therefore passes green **without ever exercising the real wire protocol**. To actually run it, build the binary first:

```bash
pnpm -F @linkcode/daemon run build:rust
pnpm test
```

CI never builds the binary inside the TypeScript job, so this cross-language test no-ops in CI — you must run it locally. `cargo test --locked` runs `smoke.rs` self-contained.

## Desktop E2E procedures

There is **no committed E2E/Playwright harness** on master — no `playwright*` dependency, no `_electron.launch` in source, no spec files. Desktop E2E is done ad-hoc: install `playwright-core` in a scratchpad and drive Electron. Neither desktop workflow runs code tests; release only validates packaging (`verify-artifacts`), and the missing CI packaged-boot smoke test is tracked as CODE-89. Hard rule: **packaging verification must actually launch the packaged product** — launch-only bugs (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, a dev-shell exit-0 lock theft) never reproduce in dev.

> Procedure from prior sessions — re-verify each step as you go. Script names and paths below are repo-verified; the keychain service name is observed behavior of the vendored CLI (re-check with `security find-generic-password -s 'Claude Code-credentials'`); the launch/driving switches are memory-sourced Chromium/Electron flags.

**Unpackaged run.** Build first (`pnpm -F @linkcode/desktop run build`; product in `out/`, main at `out/main/index.js`), then `_electron.launch({ executablePath: <repo>/node_modules/electron/dist/.../Electron, args: [<repo>/apps/desktop] })`. Drive the main process with `app.evaluate(({ Menu, nativeTheme, app }) => …)`.

**Isolation (do not skip).**

- `userData` for any unpackaged run on macOS is `~/Library/Application Support/LinkCode Dev` (`IS_DEV_SHELL` pins the app name), shared with your daily dev instance. An E2E run **must** still pass an independent `--user-data-dir=<temp>`, or `requestSingleInstanceLock` against the daily instance makes the second Electron exit 0 (looks like nothing launched). Back up that dir's `settings.json` first.
- Isolated daemon: `HOME=<tempdir> LINKCODE_PORT=<port> pnpm -F @linkcode/daemon run dev`. Pass the **same** fake `HOME` to Electron and it auto-connects via `runtime.json` (precondition: the real `settings.json` has no `daemonUrl`). Use a **fresh** fake `HOME` per run — a reused one carries an old daemon DB and leaves the composer disabled ("Create or pick a thread first").
- Playwright pins `colorScheme: 'light'`. Theme/dark-mode E2E must pass `_electron.launch({ colorScheme: null })` or dark mode falsely looks broken.

**Keychain (macOS) — exact.** The vendored `claude` CLI reads OAuth from the login Keychain service `Claude Code-credentials` (acct = `<username>`), **not** `~/.claude/.credentials.json`. A fake `HOME` breaks that; symlink it back:

```bash
ln -sfn ~/Library/Keychains <fakeHOME>/Library/Keychains
HOME=<fakeHOME> <vendored>/claude -p 'Reply ok' --model haiku   # smoke test
```

Agent files land under `<fakeHOME>/LinkCode` (`chatWorkspaceRoot = homedir()/LinkCode`). Detect turn-end by `form button[type="submit"]` reappearing (it is `type=button` while a run is active / showing Stop). Auto/bypass here is the approval-policy "Bypass permissions" option wired through the SDK's `setPermissionMode` (`claude-code.ts`) — there is no daemon env var for it (the CLI-side `CLAUDE_CODE_ENABLE_AUTO_MODE` concerns Bedrock/gateway auth only; see `packages/agent-adapter/AGENTS.md`).

**Packaged product.** Build with `pnpm -F @linkcode/desktop run package:devshell` (there is **no** `run package` script). It stages the host runtime, runs `electron-vite build --mode devshell`, then `electron-builder --dir --config electron-builder.devshell.yml` (`productName: LinkCode Dev`, `identity: null` — unsigned by design), so you launch `LinkCode Dev.app`. `dev:mock` (`electron-vite dev --mode mock`) exists for the CDP-attach flow. Memory-only driving switches (real flags, not repo-verifiable): `--use-mock-keychain` for the keychain modal, a packaged-vs-unpackaged `--user-data-dir` inversion, the asar-unpack debug trick, and passing `--remoteDebuggingPort` as a first-class electron-vite option (before `--`).

**Feature gotchas (memory-sourced).** The composer is disabled with no thread ("Create or pick a thread first") — click the Chats `+` first. "Ask permissions" stalls a Task at approval — switch to "Bypass permissions" before spawning an agent. Clicking a sidebar thread row needs Playwright `force: true`. Match the active row by `classList.contains('bg-sidebar-accent')` exactly (`className.includes` also matches the hover variant). Webview artifact E2E (`pnpm -F @linkcode/webview run dev:mock`): mock `blob:` URLs can't cross the Electron webview process (promotion fails `ERR_FILE_NOT_FOUND`) — use a real http URL.

## Debugging and triage

### Daemon will not start

1. `curl http://127.0.0.1:19523/linkcode` — a JSON identity means it **is** up (possibly on a hunted port; the actual bound endpoint is in `~/.linkcode/runtime.json`).
2. Logs: packaged `~/Library/Logs/LinkCode/main.log`; dev — the terminal (turbo TUI).
3. Exit code `3` = another daemon already serves this machine (one-per-machine, not a crash). Kill the pid from `runtime.json`.
4. The packaged supervisor gives up after 5 fast (<30s) exits ("giving up" in the log).
5. Crash-on-boot is usually a bundle issue (missing native module / "Dynamic require not supported") — check tsup externals and that `apps/daemon/dist` built before the desktop bundle.

### Agent will not spawn

1. Confirm `installAsarSpawnFix` ran — `spawn ENOTDIR` on an `app.asar` path means the child path wasn't unpacked/rewritten.
2. claude-code: `LINKCODE_AGENT_BIN_DIR` set and `<resources>/agent-bin/claude-code/claude` exists.
3. codex has no vendored binary — its SDK's platform binary in `node_modules` needs the asar-spawn rewrite; opencode self-spawns its server via PATH; pi runs in-process and spawns nothing.
4. In dev there is no `agent-bin`; the SDK self-resolves, so a missing SDK dependency is the usual cause.

### Terminals are broken

Three sidecar degradation signatures:

- `"pty sidecar not configured: terminals are unavailable on this host"` — `resolveSidecarPath` returned `''` (a prod bundle with no `LINKCODE_PTY_SIDECAR_PATH`). Set the env var or run a dev build.
- `"pty sidecar exited"` (with `onChildGone`) — the path resolved but the binary is missing/unspawnable. Common in dev before a build — run `pnpm -F @linkcode/daemon run build:rust`.
- `"pty open timed out"` — spawned but no `OPENED`/`ERROR` within 10s (`OPEN_TIMEOUT_MS`). The sidecar spawns lazily on first open and respawns after a crash.

### Client cannot connect

The daemon advertises its bound endpoints in `~/.linkcode/runtime.json`; a client with no `daemonUrl` in `settings.json` auto-discovers through that file. If a client can't reach it, confirm the daemon is up (the `curl` above), then check that `runtime.json` exists and wasn't written under a different `HOME` than the client reads.

### Log locations

Packaged: the supervisor pipes the daemon child's stdout to electron-log `info` and stderr to `warn`, in a file keyed on the Electron app name (`LinkCode` release / `LinkCode Dev` dev shell):

- macOS `~/Library/Logs/<appName>/main.log`
- Windows `%APPDATA%/<appName>/logs/main.log`
- Linux `~/.config/<appName>/logs/main.log`

```bash
tail -f "$HOME/Library/Logs/LinkCode/main.log"
```

Dev-mode daemon logs go to its own stdout/stderr (console lines prefixed `[linkcode/daemon]`), **not** a file; under `pnpm dev` they appear in the turbo TUI.

### Reset daemon state

```bash
pnpm -F @linkcode/daemon run dev:clean
```

This deletes `~/.linkcode/daemon.db` and `~/.linkcode/runtime.json`, then starts dev. It **wipes real user state** (the session registry) — the only scripted command that touches `~/.linkcode`, not a temp copy. The plain `dev` script is `tsx watch --import ./src/instrument.ts src/index.ts` (Sentry instrument preloaded; no-ops unless `LINKCODE_SENTRY_DSN` is set).

### Recover changes lost by a failed commit hook

prek stashes unstaged tracked changes to `.devenv/state/prek/patches/<timestamp>-<pid>.patch` on every `git commit` and restores them after the hooks run; if that restore fails (or the hook run is interrupted) the working tree silently reverts to HEAD. The stash is a plain patch file — it does **not** appear in `git stash list`. Recover the newest patch:

```bash
git apply --3way "$(ls -t .devenv/state/prek/patches/*.patch | head -1)"
```

## Dev shell vs installed release isolation

A local unpackaged "dev shell" build must stay isolated from an installed release on **four** axes: app name, `userData` dir, single-instance lock, and OS keychain (safeStorage). The predicate is `IS_DEV_SHELL = MODE !== 'production' || !app.isPackaged` (a production bundle run by the dev Electron binary is still a dev shell). `APP_NAME` is `'LinkCode Dev'` for dev, `'LinkCode'` for release; main calls `app.setName(APP_NAME)` **and** `app.setPath('userData', appData/APP_NAME)`. Skipping any axis clobbers release settings, steals its instance lock (the second instance exits 0 silently), or writes a safeStorage key under the dev binary's code signature — after which the release app prompts for the keychain password on first launch (macOS keychain ACLs pin the creator cdhash). Clean a polluted machine:

```bash
security delete-generic-password -s "LinkCode Safe Storage"
```

Dev shell and release deliberately **share** `~/.linkcode` (daemon) and `~/LinkCode` (workspaces). `package:devshell` uses `electron-builder.devshell.yml`; release packaging is CI-only (the old `dist` script was removed).

## Formatting and linting

JavaScript/TypeScript use ESLint for linting and Biome for formatting (Biome's linter is disabled — it only formats):

```bash
pnpm lint
pnpm format:check
```

Auto-fix — finish the task first, then run these and re-check (most issues auto-fix):

```bash
pnpm format
pnpm lint:fix
```

Rust — run the forms CI enforces (unscoped, `--locked`):

```bash
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
```

The Cargo workspace has a single member (`crates/linkcode-pty`), so `-p linkcode-pty`-scoped forms are equivalent today, but match CI to stay correct as the workspace grows.

Before every commit run the full JS check set (exactly what CI's TypeScript job runs), then the tests separately — `check:ci` does **not** include them:

```bash
pnpm check:ci   # = format:check && lint && typecheck
pnpm test
```

## Notes

- Use `pnpm`, never `npm` or `npx`.
- The daemon inherits sidecar diagnostics from stderr; protocol data must stay on stdin/stdout.
