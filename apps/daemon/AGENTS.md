# apps/daemon — the local host process

Standalone Node process (no browser APIs, no React): constructs the shared `Engine` behind a fan-out
`Hub`, hosts the agent adapters and the PTY sidecar, and serves the data plane over the transport.
Runs via `tsx` in dev (`pnpm -F @linkcode/daemon dev`) and a `tsup` bundle in prod (`pnpm -F @linkcode/daemon build`).

## State surfaces — all under the profile's state dir

- Default state dir is `~/.linkcode/`; `LINKCODE_PROFILE=<name>` (`[a-z0-9-]`, ≤32 chars, invalid
  aborts boot) forks the whole universe to the sibling `~/.linkcode-<name>/` — including `hq.json` /
  `device-key.pem`, so each profile registers as its own HQ device (deliberate: the relay allows one
  uplink per device id). `~/LinkCode` workspaces and the managed asset store stay shared.
- **Paths are owned by `src/config.ts`** (`configPath` / `databasePath` / `runtimeFilePath`) — never
  scatter `homedir()` joins elsewhere. `os.homedir()` is read at call time, so a fake `$HOME` fully
  redirects config/db/runtime (this is what isolates an E2E daemon).
- **`config.json`** (optional, `0600` because `providers` may hold API keys): the daemon writes back
  only `providers` via `saveProviders`, re-reading and preserving other fields. `loadConfig` validates
  providers **field-by-field** — one bad entry is dropped and logged, never blanks the rest.
- **`daemon.db`** — better-sqlite3 session/workspace registry (`session-store.ts` / `workspace-store.ts`,
  tables in `src/db/schema.ts`). The zod `SessionRecordSchema` is the contract: rows are re-validated
  through it on load; the table is just storage. After editing `src/db/schema.ts`, run
  `pnpm -F @linkcode/daemon exec drizzle-kit generate` and commit `drizzle/` — migrations run at boot.
- **`runtime.json`** — endpoint discovery (`{name,pid,startedAt,listeners:[{type,url}]}`), written
  `0600` only AFTER every listener binds and removed on graceful `SIGINT`/`SIGTERM` shutdown.

## Ports & one-per-profile

- Default listener is `socket.io` on `127.0.0.1:19523` (`0x4C43` = ascii `'LC'`, `DAEMON_DEFAULT_PORT`
  in `packages/schema`). `LINKCODE_PORT` / `LINKCODE_HOST` override every listener. On `EADDRINUSE` a
  listener hunts **upward** up to 10 ports (19523–19532); clients must read `runtime.json`, never
  assume 19523.
- **One daemon per profile**, enforced by the daemon (not the desktop supervisor): `main()` calls
  `findRunningDaemon()` — parse the profile's `runtime.json` → pid alive? → `GET /linkcode` identity
  pid matches? A live one makes the new process log `already running (pid N)` and `process.exit(3)`
  (`DAEMON_EXIT_ALREADY_RUNNING`) — an **explicit** exit because Electron's `utilityProcess` keeps the
  parent IPC channel and the event loop alive forever. The identity (and `runtime.json`) carries an
  optional `profile` field (absent = default profile): the port hunt treats a live daemon of
  **another** profile as a port neighbor and hunts past it, so profiles coexist on adjacent ports.
  Health: `curl http://127.0.0.1:19523/linkcode`.

## Packaging: spawn, binaries & bundle

- **`installAsarSpawnFix()` is the FIRST line of `main()`** (`src/asar-spawn.ts`). Symptom it fixes:
  `spawn ENOTDIR` launching an agent in the packaged app — Electron rewrites asar paths for
  `execFile`/`fork` but not raw `spawn`, so spawning an `app.asar/…` path traverses the asar file as a
  directory. The patch rewrites `/app.asar/` → `/app.asar.unpacked/` when the unpacked copy exists,
  then `syncBuiltinESMExports()` so SDKs that `import { spawn }` see it. No-op outside Electron.
  **Never guess a spawnable path by walking parents or from `node_modules`** (a tsup bundle sits at a
  different depth than `tsx` src) — hand it in via env, and keep real executables unpacked (`asarUnpack`).
- **Agent binaries do not ship in the app (CODE-114); the daemon provisions them (CODE-111).**
  claude/codex resolve via the runtime probe (`packages/agent-adapter/src/probe/`): managed
  install from the daemon's asset store (`@linkcode/assets` — platform data dir, e.g.
  `~/Library/Application Support/LinkCode/assets`, `LINKCODE_ASSETS_DIR` override for tests/E2E;
  SDK-pinned exact pair, SRI-verified, GC'd at boot) → detected user install at known locations
  (brew, `~/.local/bin`; version-verified) → SDK self-resolution from node_modules
  (dev/standalone). **The first managed download is always user-prompted** (CODE-221): boot
  auto-refreshes only agents with a prior install in the asset store (standing consent — GC
  retains superseded versions until the replacement lands, so an offline refresh failure keeps
  retrying on later boots); an agent never installed there waits for the client's explicit
  `asset.ensure` (the onboarding Download card). Boot never waits on a download either way. The
  engine must be constructed **before** that refresh loop kicks off —
  it subscribes to the AssetManager and forwards install progress to clients
  (`asset.progress`/`asset.settled`), re-probing and pushing `agent-runtime.changed` when an
  agent install completes (CODE-112). opencode self-spawns the `opencode` command via PATH
  (CODE-76); pi runs in-process and spawns nothing.
- **PTY sidecar** is a Rust binary (`linkcode-pty`, `pnpm -F @linkcode/daemon run build:rust`);
  the resolution order and degradation strings live in `docs/DEVELOPMENT.md` (Rust PTY sidecar +
  terminal triage). Treat the framed-stdio protocol as hostile; its design lives in
  `crates/linkcode-pty` + `src/pty/`.
- **`tsup` bundle:** workspace packages export raw TS source, so they **must be bundled**
  (`noExternal: [/^@linkcode\//]`) — never externalize `@linkcode/*`. The agent SDKs and `ws` stay
  `external` (native binaries / subprocesses break when bundled). A `createRequire` banner supplies the
  `require` inlined CJS deps call — a boot crash `Dynamic require of … is not supported` means that
  broke. `splitting: false` is required: the desktop packaging copies only `dist/index.js` into the
  asar (electron.vite.config.ts `bundle-daemon-artifact`), so a split bundle boots to
  `ERR_MODULE_NOT_FOUND` on a missing `chunk-*.js` (a dynamic `import()` reached via `@linkcode/assets`
  is what started the split). `apps/daemon/dist` must build before the desktop bundle.
- **Standalone distribution:** `pnpm -F @linkcode/daemon package` (`scripts/package-daemon.mts`)
  materializes a self-contained dir at `apps/daemon/standalone` (gitignored; pass an explicit path as
  argv for CI) via `pnpm --prod deploy` — the tsup bundle plus its runtime externals flat in the dir's
  own `node_modules`, runnable anywhere as `node --import ./dist/instrument.js dist/index.js`. This is
  distinct from the desktop bundle: it targets **plain Node** (better-sqlite3 keeps its prebuild-install
  binary — a **same-platform** artifact, build per target), and it prunes the host-arch agent CLI
  platform packages (the daemon downloads them at runtime via `@linkcode/assets`, as the desktop does).
  Terminals need `LINKCODE_PTY_SIDECAR_PATH` pointed at a built `linkcode-pty`, else they degrade.
  The package `files: ["dist", "drizzle"]` keeps the deploy (and any pack) to runtime files only —
  no `src`/configs — while the `dependencies` field still drives the full runtime closure; this is
  also why the standalone dir carries no test files for the root vitest runner to pick up.

## Engine wiring, errors & lifecycle

- **Injection over imports.** The `Engine` receives daemon-owned implementations (`ProviderConfigStore`,
  `SessionStore`, `WorkspaceStore`, `PtyBackend`) at construction; defaults stay in-memory so bare
  engines and tests need no daemon. New persistence: interface in `@linkcode/engine`, implementation here.
- **Wire version:** every message pins `v: z.literal(WIRE_PROTOCOL_VERSION)`
  (`packages/schema/src/wire/index.ts`); a version mismatch means silent frame drops — see root
  `AGENTS.md`, Invariant 1. Any wire change bumps the literal; after a bump, rebuild and restart the
  daemon and every client.
- **Process safety:** `uncaughtException` logs `[linkcode/daemon] uncaught exception:` then
  `process.exit(1)` (state untrustworthy); `unhandledRejection` logs
  `[linkcode/daemon] unhandled rejection:` and keeps running — a rejection reaching it is a missed
  `.catch` to fix. **No fire-and-forget on data-plane paths**: await inside try/catch and log, and move
  user-visible side effects after the awaited op succeeds. Full bug catalog → `docs/DEVELOPMENT.md`.
- **Lifecycle:** at boot the daemon `ensureChatWorkspace(~/LinkCode)` **before** any listener binds, so
  `workspace.list` always includes the "Chats" workspace. A host terminal survives while any local
  or relay-virtual connection retains an attachment; the Hub turns connection loss into detach, and
  the terminal is reaped 60s after its last attachment leaves. Reattaching within the window cancels
  the reap. Session/managed terminals keep their owner's lifecycle instead.

## Pointers

- **Client dial models differ:** desktop discovers via `runtime.json` + fs-watch (follows a port-hunted
  daemon); the webview uses a fixed URL and cannot follow a moved port (detail in `apps/desktop` / `apps/webview`).
- Ordered "daemon/agent won't start" triage, log locations, and DB reset → **`docs/DEVELOPMENT.md`**.
- Agent adapter invariants (SDK↔CLI lockstep, per-agent quirks) → **`packages/agent-adapter/AGENTS.md`**.
