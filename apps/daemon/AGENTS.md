# apps/daemon — the local host process

Standalone Node process (no browser APIs, no React): constructs the shared `Engine` behind a fan-out
`Hub`, hosts the agent adapters and the PTY sidecar, and serves the data plane over the transport.
Runs via `tsx` in dev (`pnpm -F @linkcode/daemon dev`) and a `tsup` bundle in prod (`pnpm -F @linkcode/daemon build`).

## State surfaces — all under `~/.linkcode/`

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

## Ports & one-per-machine

- Default listener is `socket.io` on `127.0.0.1:19523` (`0x4C43` = ascii `'LC'`, `DAEMON_DEFAULT_PORT`
  in `packages/schema`). `LINKCODE_PORT` / `LINKCODE_HOST` override every listener. On `EADDRINUSE` a
  listener hunts **upward** up to 10 ports (19523–19532); clients must read `runtime.json`, never
  assume 19523.
- **One daemon per machine**, enforced by the daemon (not the desktop supervisor): `main()` calls
  `findRunningDaemon()` — parse `runtime.json` → pid alive? → `GET /linkcode` identity pid matches? A
  live one makes the new process log `already running (pid N)` and `process.exit(3)`
  (`DAEMON_EXIT_ALREADY_RUNNING`) — an **explicit** exit because Electron's `utilityProcess` keeps the
  parent IPC channel and the event loop alive forever. Health: `curl http://127.0.0.1:19523/linkcode`.

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
  (dev/standalone). Boot never waits on a download: missing agent pairs warm in the background
  and win resolution as soon as they land. The engine must be constructed **before** that warm
  loop kicks off — it subscribes to the AssetManager and forwards install progress to clients
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
  broke. `apps/daemon/dist` must build before the desktop bundle.

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
  `workspace.list` always includes the "Chats" workspace. Host (panel) terminals are reaped 60s after
  the last client disconnects (`hub.size === 0`); a reconnect within the window cancels the reap.

## Pointers

- **Client dial models differ:** desktop discovers via `runtime.json` + fs-watch (follows a port-hunted
  daemon); the webview uses a fixed URL and cannot follow a moved port (detail in `apps/desktop` / `apps/webview`).
- Ordered "daemon/agent won't start" triage, log locations, and DB reset → **`docs/DEVELOPMENT.md`**.
- Agent adapter invariants (SDK↔CLI lockstep, per-agent quirks) → **`packages/agent-adapter/AGENTS.md`**.
