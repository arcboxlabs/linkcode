# LinkCode development

The local runbook: run the apps, run the tests, debug a stuck daemon. For architecture and package boundaries read [`ARCHITECTURE.md`](./ARCHITECTURE.md); for engineering discipline read [`../AGENTS.md`](../AGENTS.md).

## Prerequisites

> [!NOTE]
> `devenv` is recommended: it pins Node.js 26, pnpm 11, stable Rust, and the `prek` pre-commit hooks. It is not required if your local toolchain already matches.

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
devenv shell -- app
```

`app` first builds the Rust PTY sidecar, then starts the daemon and desktop dev processes in parallel. Without `devenv`, run the same sequence:

```bash
pnpm -F @linkcode/daemon run build:rust
pnpm --filter @linkcode/daemon --filter @linkcode/desktop --parallel dev
```

Root `pnpm dev` (= `turbo run dev`) is different: it starts the three persistent dev tasks at once — daemon, desktop, and webview. Use `-F`/`--filter` to run a subset. `apps/mobile` and the `packages/*/*` have no `dev` script.

### Daemon only

```bash
devenv shell -- daemon
# without devenv:
pnpm -F @linkcode/daemon run build:rust
pnpm -F @linkcode/daemon run dev
```

### Desktop only

```bash
devenv shell -- desktop
# without devenv:
pnpm -F @linkcode/desktop run dev   # scripts/dev.mts: vite builds + dev server + electron
```

### Webview (browser renderer)

There is no `devenv` script for the webview. Run it directly:

```bash
pnpm -F @linkcode/webview run dev   # vite
```

### Mobile (Expo, iOS)

```bash
devenv shell -- mobile
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

There is exactly **one** test runner: root `pnpm test` (= `vitest run`), driven by a single root `vitest.config.ts` with `environment: 'node'`. Test placement follows the boundary under test:

- Module unit and behavior tests stay beside their source under package/app `src/**/__tests__`.
- `tests/contract` is only for consumer contracts exercised through a workspace's public exports; it must not import private `src` modules.
- `tests/integration` is for real process or runtime boundaries: loopback network servers, native databases, CLI/child processes, compiled binaries, or multiple runtimes wired together. A temporary filesystem by itself does not make a test an integration test.
- App `e2e/` tests launch the real app entry and drive it externally; renderer component tests are not E2E.

Shared external-test fixtures live under `tests/support` and are type-checked but are not test entry points. Test files use `*.test.ts` or `*.test.tsx`; DOM component tests opt in per file with `@vitest-environment jsdom`. No app or package has its own `test` script and `turbo.json` has no `test` task, so `turbo run test` does nothing. Run one area by passing a path or name filter:

```bash
pnpm test apps/daemon/src/pty     # just the PTY unit tests
```

### CI runs Vitest and process acceptance separately

CI (`.github/workflows/ci.yml`) has six jobs: **typescript** (`format:check`, `lint`, `typecheck`, a debug `linkcode-pty` build, required-sidecar Vitest, then the compiled-daemon process acceptance), **desktop** (unpackaged Electron entry, window-state persistence, plus an unsigned packaged devshell), **webview** (the production bundle in Chromium, followed by the bundled mock entry and wire-compatible mock host), **mobile** (Android and iOS Expo Router production exports), **rust** (`cargo fmt --check`, `clippy`, `test`), and an **All Green** aggregate gate over all five required jobs. `check:ci` still excludes Vitest and app acceptance, so run the applicable commands below before every commit rather than treating any one command as the complete gate. A `tsconfig` that excludes its own test files silently hides test type errors (agent-adapter once hid 6 this way).

The daemon acceptance driver is deliberately outside Vitest: it starts `dist/index.js` as an external process with an isolated `HOME`, waits for `runtime.json`, checks the HTTP identity, connects a public `LinkCodeClient` through Socket.IO, reads the migrated native SQLite database, and opens a shell through the real PTY sidecar. Run the same boundary locally with:

```bash
cargo build --locked -p linkcode-pty
pnpm -F @linkcode/daemon build
LINKCODE_PTY_SIDECAR_PATH="$PWD/target/debug/linkcode-pty" pnpm -F @linkcode/daemon e2e:startup
```

Every workspace with a root `tests/` directory must provide `tests/tsconfig.json`, extending its production config with the workspace root as `rootDir`, and the root `tsconfig.json` must reference it. Vitest discovery alone does not type-check every support file.

Store tests load the `better-sqlite3` native binding (allow-listed under `allowBuilds:` in `pnpm-workspace.yaml`). If that build was skipped, `pnpm test` fails at require time loading the store — a native-binding error, not a test-logic failure.

### PTY test layers

The PTY subsystem has four layers, and the frame protocol is implemented **twice** (Rust `proto.rs`, TS `codec.ts`) — only layers 3–4 catch a mismatch between them:

1. `apps/daemon/src/pty/__tests__/codec.test.ts` — pure TS frame codec.
2. `apps/daemon/src/pty/__tests__/sidecar.test.ts` — `SidecarPtyBackend` with `vi.mock('node:child_process')`; no real binary.
3. `apps/daemon/tests/integration/pty-sidecar.test.ts` — real backend against the real compiled `linkcode-pty` (cross-boundary wire check).
4. `crates/linkcode-pty/tests/smoke.rs` — Rust, unix-only, self-builds via `CARGO_BIN_EXE_linkcode-pty`.

**Local silent-skip trap:** layer 3 is `describe.skipIf(!BINARY)` and skips when `linkcode-pty` isn't built (it looks for `target/debug` then `target/release`, first existing wins, else skip), so plain local `pnpm test` may not exercise the real wire protocol. CI builds the debug binary and sets `LINKCODE_REQUIRE_PTY_SIDECAR=1`, which turns a missing binary into a hard failure before either critical suite can skip. To run the same boundary locally, build the binary first:

```bash
pnpm -F @linkcode/daemon run build:rust
LINKCODE_REQUIRE_PTY_SIDECAR=1 pnpm test apps/daemon/tests/integration/pty-sidecar.test.ts apps/daemon/tests/integration/terminal-flood.test.ts
```

`cargo test --locked` also runs `smoke.rs` self-contained in the Rust job; the required TypeScript suites are the separate check that the TS and Rust implementations agree over the real process boundary.

The multi-device terminal contract has a separate in-process integration check. It opens from a
desktop peer, attaches a late mobile controller through the Hub, verifies replay plus live output,
rejects stale desktop input, and keeps the PTY alive after the desktop peer disconnects:

```bash
pnpm test packages/host/engine/src/__tests__/terminal-takeover.test.ts
```

For the manual flow, open a terminal in desktop and produce recognizable output, then open the same
terminal from mobile and take control. The old output must appear before new live bytes; input and
resize must come only from mobile after takeover. Closing the desktop tab detaches its view and must
not terminate the mobile-controlled PTY. Use the explicit terminate action when process death is the
intended operation.

## Desktop E2E procedures

The CI entry smoke tests are `e2e:unpackaged`, `e2e:window-bounds`, and `e2e:packaged`. The first launches the built main/preload/renderer and calls the sandbox preload bridge. The window check relaunches Electron to prove first-run sizing and persisted normal/maximized bounds; a headless Xvfb run needs a window manager such as Openbox because Linux maximize is a window-manager operation. The packaged check builds and launches the unsigned devshell directory product, proves that its renderer crosses the connection gate, then exercises its preload bridge, supervised bundled daemon, native SQLite migrations, staged PTY sidecar, and graceful app/daemon shutdown. Run all three on Linux with `xvfb-run`; the packaged check is intentionally not evidence for signing or notarization:

```bash
xvfb-run -a pnpm -F @linkcode/desktop e2e:unpackaged
xvfb-run -a sh -c 'openbox >/tmp/linkcode-openbox.log 2>&1 & wm_pid=$!; trap "kill $wm_pid 2>/dev/null || true" EXIT; pnpm -F @linkcode/desktop e2e:window-bounds'
xvfb-run -a pnpm -F @linkcode/desktop e2e:packaged
```

The feature E2E `apps/desktop/e2e/notifications.e2e.mts` (`pnpm -F @linkcode/desktop e2e:notifications`, `playwright-core` devDependency) self-orchestrates an isolated daemon + built desktop app and asserts the OS-notification chain end to end — use it as the template for flows that need a real agent (fresh fake `HOME`, `--user-data-dir`, `--use-mock-keychain`, main-process interception via `app.evaluate`). Those agent-dependent E2Es remain manual. Hard rule: **packaging verification must actually launch the packaged product** — launch-only bugs (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, a dev-shell exit-0 lock theft) never reproduce in dev.

> Procedure from prior sessions — re-verify each step as you go. Script names and paths below are repo-verified; the keychain service name is observed behavior of the vendored CLI (re-check with `security find-generic-password -s 'Claude Code-credentials'`); the launch/driving switches are memory-sourced Chromium/Electron flags.

**Unpackaged run.** Build first (`pnpm -F @linkcode/desktop run build`; product in `out/`, main at `out/main/index.js`), then `_electron.launch({ executablePath: <repo>/node_modules/electron/dist/.../Electron, args: [<repo>/apps/desktop] })`. Drive the main process with `app.evaluate(({ Menu, nativeTheme, app }) => …)`.

**Isolation (do not skip).**

- `userData` for any unpackaged run on macOS is `~/Library/Application Support/LinkCode Development` (the `development` channel pins the app name), shared with your daily dev instance. An E2E run **must** still pass an independent `--user-data-dir=<temp>`, or `requestSingleInstanceLock` against the daily instance makes the second Electron exit 0 (looks like nothing launched). Back up that dir's `settings.json` first.
- Isolated daemon: `HOME=<tempdir> LINKCODE_PORT=<port> pnpm -F @linkcode/daemon run dev`. Pass the **same** fake `HOME` to Electron and it auto-connects via `runtime.json` (precondition: the real `settings.json` has no `daemonUrl`). Use a **fresh** fake `HOME` per run — a reused one carries an old daemon DB and leaves the composer disabled ("Create or pick a thread first").
- Always launch Electron with `--use-mock-keychain`: a fake `HOME` has no login keychain, and without the flag macOS pops a blocking "Keychain Not Found / reset" dialog on the developer's screen at every launch.
- Playwright pins `colorScheme: 'light'`. Theme/dark-mode E2E must pass `_electron.launch({ colorScheme: null })` or dark mode falsely looks broken.

**Keychain (macOS) — exact.** The vendored `claude` CLI reads OAuth from the login Keychain service `Claude Code-credentials` (acct = `<username>`), **not** `~/.claude/.credentials.json`. A fake `HOME` breaks that; symlink it back:

```bash
ln -sfn ~/Library/Keychains <fakeHOME>/Library/Keychains
HOME=<fakeHOME> <vendored>/claude -p 'Reply ok' --model haiku   # smoke test
```

Agent files land under `<fakeHOME>/LinkCode` (`chatWorkspaceRoot = homedir()/LinkCode`). Detect turn-end by `form button[type="submit"]` reappearing (it is `type=button` while a run is active / showing Stop). Auto/bypass here is the approval-policy "Bypass permissions" option wired through the SDK's `setPermissionMode` (`claude-code.ts`) — there is no daemon env var for it (the CLI-side `CLAUDE_CODE_ENABLE_AUTO_MODE` concerns Bedrock/gateway auth only; see `packages/host/agent-adapter/AGENTS.md`).

**Packaged product.** Build with `pnpm -F @linkcode/desktop run package:devshell` (there is **no** `run package` script). It stages the host runtime, runs `node scripts/build.mts --mode devshell`, then `electron-builder --dir --config electron-builder.devshell.yml` (`productName: LinkCode Development`, `identity: null` — unsigned by design), so you launch `LinkCode Development.app`. `dev:mock` (`scripts/dev.mts --mode mock`) exists for the CDP-attach flow. Memory-only driving switches (real flags, not repo-verifiable): `--use-mock-keychain` for the keychain modal, a packaged-vs-unpackaged `--user-data-dir` inversion, and the asar-unpack debug trick. Electron flags such as `--remote-debugging-port` and `--profile` pass through `dev`/`dev:mock` with or without a `--` separator (e.g. `pnpm -F @linkcode/desktop dev --remote-debugging-port=9222`).

**Feature gotchas (memory-sourced).** The composer is disabled with no thread ("Create or pick a thread first") — click the Chats `+` first. "Ask permissions" stalls a Task at approval — switch to "Bypass permissions" before spawning an agent. Clicking a sidebar thread row needs Playwright `force: true`. Match the active row by `classList.contains('bg-sidebar-accent')` exactly (`className.includes` also matches the hover variant). Webview artifact E2E (`pnpm -F @linkcode/webview run dev:mock`): mock `blob:` URLs can't cross the Electron webview process (promotion fails `ERR_FILE_NOT_FOUND`) — use a real http URL.

## Webview and mobile entry smoke tests

The webview browser smoke builds the daemon and production bundle, then launches Chromium against the emitted assets with that isolated daemon as its real Socket.IO host and drives the index/Settings routes. It next starts the Vite app in mock mode and sends prompts through the workbench's real wire-compatible mock transport before and after a full reload. Install Playwright's Chromium shell once, then run:

```bash
pnpm -F @linkcode/webview exec playwright-core install chromium --only-shell
pnpm -F @linkcode/webview e2e:browser
```

The mobile smoke performs separate production exports from the real Expo Router entry for Android and iOS. It requires Hermes bytecode and source maps, then verifies that the root layout, startup route, host route, and terminal route were all included by Metro. This is an app-entry bundle gate, **not** simulator/device E2E and not evidence that native modules load on a device:

```bash
pnpm -F @linkcode/mobile smoke:export
```

## Debugging and triage

### Daemon will not start

1. `curl http://127.0.0.1:19523/linkcode` — a JSON identity means it **is** up (possibly on a hunted port; the actual bound endpoint is in `~/.linkcode/runtime.json`).
2. Logs: packaged `~/Library/Logs/LinkCode/main.log`; dev — the terminal (turbo TUI).
3. Exit code `3` = another daemon already serves this machine (one-per-machine, not a crash). Kill the pid from `runtime.json`.
4. The packaged supervisor gives up after 5 fast (<30s) exits ("giving up" in the log).
5. Crash-on-boot is usually a bundle issue (missing native module / "Dynamic require not supported") — check tsup externals and that `apps/daemon/dist` built before the desktop bundle.

### Agent will not spawn

1. Confirm `installAsarSpawnFix` ran — `spawn ENOTDIR` on an `app.asar` path means the child path wasn't unpacked/rewritten.
2. claude-code/codex resolve in order (CODE-110/111/114): managed install from the daemon's asset store (`@linkcode/assets`; platform data dir such as `~/Library/Application Support/LinkCode/assets`, `LINKCODE_ASSETS_DIR` override — check `asset.list` over the wire or look for `<store>/agent/<kind>/<version>/` on disk) → detected user install (brew / `~/.local/bin`, probed at daemon boot — check `agent-runtime.list` over the wire or re-run `--version` by hand) → SDK self-resolution from node_modules. **Packaged apps ship no agent binaries**: on a machine with no local claude/codex CLI the daemon downloads the SDK-pinned pair in the background at boot; until that install lands only pi is usable.
3. opencode self-spawns its server via PATH; pi runs in-process and spawns nothing.
4. Detection re-probes only at daemon boot — after installing/upgrading a CLI, restart the daemon.

### Terminals are broken

Three sidecar degradation signatures:

- `"pty sidecar not configured: terminals are unavailable on this host"` — `resolveSidecarPath` returned `''` (a prod bundle with no `LINKCODE_PTY_SIDECAR_PATH`). Set the env var or run a dev build.
- `"pty sidecar exited"` (with `onChildGone`) — the path resolved but the binary is missing/unspawnable. Common in dev before a build — run `pnpm -F @linkcode/daemon run build:rust`.
- `"pty open timed out"` — spawned but no `OPENED`/`ERROR` within 10s (`OPEN_TIMEOUT_MS`). The sidecar spawns lazily on first open and respawns after a crash.

### Client cannot connect

The daemon advertises its bound endpoints in `~/.linkcode/runtime.json`; a client with no `daemonUrl` in `settings.json` auto-discovers through that file. If a client can't reach it, confirm the daemon is up (the `curl` above), then check that `runtime.json` exists and wasn't written under a different `HOME` than the client reads.

### Log locations

Packaged: the supervisor pipes the daemon child's stdout to electron-log `info` and stderr to `warn`, in a file keyed on the Electron app name (`LinkCode` release / `LinkCode Development` dev shell; a `--profile` suffixes ` (<name>)`):

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

### Sentry (local)

DSNs are publishable ids; without them the SDKs no-op (the default for local dev).

| Surface | Env | Repo secret (CI / release) |
| --- | --- | --- |
| Desktop main + renderer + packaged daemon | `MAIN_VITE_SENTRY_DSN` (build-time; supervisor copies it to `LINKCODE_SENTRY_DSN`) | `SENTRY_DSN_DESKTOP` (signed desktop builds only) |
| Daemon (standalone / `pnpm -F @linkcode/daemon dev`) | `LINKCODE_SENTRY_DSN` | — (set at process env) |
| Webview | `VITE_SENTRY_DSN` | `SENTRY_DSN_WEBVIEW` |
| Mobile | `EXPO_PUBLIC_SENTRY_DSN` | `SENTRY_DSN_MOBILE` (also set on EAS project env for `eas build`) |

### Recover changes lost by a failed commit hook

prek stashes unstaged tracked changes to `.devenv/state/prek/patches/<timestamp>-<pid>.patch` on every `git commit` and restores them after the hooks run; if that restore fails (or the hook run is interrupted) the working tree silently reverts to HEAD. The stash is a plain patch file — it does **not** appear in `git stash list`. Recover the newest patch:

```bash
git apply --3way "$(ls -t .devenv/state/prek/patches/*.patch | head -1)"
```

## Identity: channel × profile isolation

The desktop identity is two orthogonal axes (`apps/desktop/src/main/constants.ts`), and app name, `userData` dir, single-instance lock, and OS keychain (safeStorage) all derive from them; `src/main/identity.ts` applies the identity as main's **first import**, and boot logs a `userData: <path>` line as self-evidence.

- **channel** — `CHANNEL === 'development'` for any build that is not the released app: `MODE !== 'production' || !app.isPackaged` (a production bundle run by the dev Electron binary is still a dev shell). `APP_NAME` is `'LinkCode Development'` for dev, `'LinkCode'` for release. Skipping any isolation axis clobbers release settings, steals its instance lock (the second instance exits 0 silently), or writes a safeStorage key under the dev binary's code signature — after which the release app prompts for the keychain password on first launch (macOS keychain ACLs pin the creator cdhash).
- **profile** — an optional isolated universe: `--profile=<name>` (or `LINKCODE_PROFILE`; `[a-z0-9-]`, ≤32 chars, invalid aborts boot). It suffixes the app name (`LinkCode Development (alpha)`) — forking the same four axes again — and is injected as `LINKCODE_PROFILE` into the supervised daemon, which forks its state dir to `~/.linkcode-<name>` and its HQ device identity with it. Two profiles therefore run side by side: daemons hunt past each other's ports, and each desktop follows its own `runtime.json`. The devenv `daemon`/`desktop`/`app` scripts set `LINKCODE_PROFILE=dev` on their dev commands, so the daemon and the desktop share the profile and agree on its `runtime.json`; for another profile, invoke `pnpm -F … dev` directly with the value you want.

Clean a polluted machine (also after the `LinkCode Dev` → `LinkCode Development` rename, which orphaned the old dir and keychain entry by design — a rename migration would carry ciphertext the new keychain entry cannot decrypt):

```bash
security delete-generic-password -s "LinkCode Safe Storage"
security delete-generic-password -s "LinkCode Dev Safe Storage"   # pre-rename leftover
rm -rf "$HOME/Library/Application Support/LinkCode Dev"           # pre-rename leftover
```

Every channel and the default profile deliberately **share** `~/.linkcode` (daemon) and `~/LinkCode` (workspaces); only an explicit `--profile` forks the daemon state, and `~/LinkCode` plus the managed asset store stay shared even then. This sharing is why the devenv dev scripts default to the `dev` profile: a dev daemon on the default profile would contend for `~/.linkcode`/`19523` with an installed release, and whichever binds first wins — the loser's client then dials a peer on a different `WIRE_PROTOCOL_VERSION`, every frame is silently dropped, and it surfaces as "Unable to connect to the daemon". `package:devshell` uses `electron-builder.devshell.yml`; release packaging is CI-only (the old `dist` script was removed).

## Formatting and linting

JavaScript/TypeScript use ESLint for linting and Biome for formatting (Biome's linter is disabled — it only formats):

```bash
pnpm lint
pnpm format:check
```

`pnpm lint` pins `--concurrency=2`: ESLint's `auto` spawns a worker per core, which measures 1.5–2× slower wall-clock than two workers for this typed-lint workload (and CI runners have 2 vCPUs).

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
