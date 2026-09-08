# apps/daemon — the local host process

Standalone Node process (no browser APIs, no React): constructs the shared `Engine` behind a fan-out
`Hub`, hosts the agent adapters and the PTY sidecar, and serves the data plane over the transport.
Runs via `tsx` in dev (`pnpm -F @linkcode/daemon dev`) and a `tsup` bundle in prod (`pnpm -F @linkcode/daemon build`).

## State surfaces — all under the profile's state dir

- The state dir is picked by **channel × profile** (CODE-460). Channel comes from
  `daemonChannel()` (`src/paths.ts`): injected `LINKCODE_CHANNEL` → tsup's build-time
  `LINKCODE_BUILD_CHANNEL` stamp (`release`) → `development`. So `~/.linkcode/` is the released
  app's alone and running the source lands in `~/.linkcode.development/`; the suffix is
  dot-separated because profile names forbid dots, making collision with `--profile=development`
  impossible. `LINKCODE_PROFILE=<name>` (`[a-z0-9-]`, ≤32 chars, invalid aborts boot) then forks
  the sibling `~/.linkcode[.development]-<name>/` — including `cloud.json` and the device key, so each
  universe registers as its own cloud device (deliberate: the relay allows one uplink per device id).
  The OS-keyring service name forks on the same pair, so the universes cannot read each other's
  secrets either.
  Workspaces (`~/LinkCode` vs `~/LinkCode Development`) and the managed asset store fork by channel
  but are shared across a channel's profiles. **Resolve the channel per call, never at module
  load** — `instrument.ts` derives a state path in its module body, and `--import` runs it before
  `index.ts` (the CODE-166 bug class).
- **Paths are owned by `src/config.ts`** (`configPath` / `databasePath` / `runtimeFilePath`) — never
  scatter `homedir()` joins elsewhere. `os.homedir()` is read at call time, so a fake `$HOME` fully
  redirects config/db/runtime (this is what isolates an E2E daemon).
- **`config.json`** (optional, `0600`): provider and account updates persist together through one
  fsynced same-directory temporary file, atomic rename, and POSIX parent-directory fsync, preserving
  other fields; custom MCP structure uses the same durable replacement while generation-linked vault
  refs keep its cross-file update crash-consistent. Malformed or unreadable input fails closed.
  `loadConfig` validates entries **field-by-field** — one bad entry is dropped and logged, never
  blanks the rest. It holds **no secrets** since CODE-371 — `providers[kind].apiKey`, each account's
  credential secret, and custom MCP env/header values live in `secrets.json` below, and
  `withAccountSecret` merges them back *before* zod validation, so a secret that is gone fails
  `AccountSchema` and drops through that same per-entry path.
- **`secrets.json`** (`0600`) — every long-lived credential, keyed `namespace:key`: `cloud:session`,
  `provider:<kind>`, `account:<id>`, custom MCP server/field tuples, `device:software-key`. Custody
  is a 32-byte AES-256-GCM master key in the OS keyring
  (`@napi-rs/keyring`, service = `keyringServiceName(channel, profile)` so a development daemon cannot
  read the release one's), and the file is ciphertext.
  - **`vault.namespace(name)` is the only way in** — there is no whole-store handle. That is what
    makes `SecretStore.replaceAll` safe to hand out: a normal `save*` replaces its own namespace in
    one write, so pruning a deleted account is implicit and cannot reach a neighbour's secrets.
    Custom MCP is the cross-file exception: refs include a config generation; save writes old+new
    refs, atomically points `config.json` at the new generation, then prunes the old refs. Either side
    of a process crash therefore names a complete snapshot. Adding a subsystem is one entry in the
    `SecretNamespace` union plus its own key names; custom MCP values use the `custom-mcp` namespace. The vault stays
    ignorant of what any of them mean.
  - **The vault is constructed once, in `main()`, and passed down.** Every consumer takes a
    `SecretVault` parameter and opens its own namespace — nothing reaches `secretVault()` by import.
    That is what lets tests hand over `createInMemoryVault()` instead of mocking the module, and what
    a future consumer outside `apps/daemon` would need (it would take the same parameter, supplied
    through the engine's injected-store pattern). **On a host with no usable keyring it degrades to plaintext rather than
  failing closed** — a deliberate trade so headless machines survive a restart — recording
  `protection: "plaintext"` in the file and warning at boot; it re-encrypts itself as soon as a
  keyring appears. Consequences to expect:
  - **A keyring that does not retain the key counts as no keyring.** `@napi-rs/keyring` silently uses
    the kernel keyring (keyutils) on a Linux host with no D-Bus Secret Service, and those keys die
    with the boot — so the store would read as encrypted while losing every credential on each
    restart. The binding cannot be asked which backend it chose (no equivalent of Chromium's
    `getSelectedStorageBackend`), so the vault infers it from the one observable symptom: a
    **freshly minted master key sitting beside existing ciphertext**. That sets `keyringDistrusted`
    in the file, which is sticky, skips the keyring entirely on later boots, and suppresses the
    plaintext→encrypted upgrade so the two cannot fight each other. `rm secrets.json` re-arms it.
    Linux-only by design: on macOS/Windows the same symptom means someone deleted the entry, which is
    no reason to stop encrypting. Cost is one loss before the demotion sticks — still strictly better
    than losing everything on every reboot, which is what the undetected case does.
  - **Losing the keyring entry loses exactly the secrets**, never the surrounding config: the daemon
    reads as signed out, vault-backed accounts drop from the pool, and the software device key is
    reminted under a new device id. That is coherent because one vault holds all of them — the
    session token is gone too, so the next sign-in re-registers. Recovery is re-entering credentials.
  - **Backups of `~/.linkcode` do not carry the secrets** unless the keyring travels with them, and a
    keyring is per-user and per-machine. Restoring a backup onto another machine yields exactly the
    reset above. A `protection: "plaintext"` file is the exception — it is fully portable, which is
    the same sentence as "it is readable by anything that can read the file".
  - **Sign-out** (`clearCloudCredentials`) deletes the vault ref *and* both `cloud.json` and the
    pre-rename `hq.json`; deleting an account prunes its `account:<id>` ref. Nothing is left behind
    to resurrect.
  - Migration is lazy and idempotent, driven by whatever a read finds: `loadConfig` moves inline
    `config.json` secrets, `loadCloudCredentials` moves an inline token and adopts `hq.json`, and
    boot sweeps `device-key.pem` explicitly (`adoptLegacyDeviceKeyFile`) — that last one needs its own
    call because the hosts that most need it, signed out or since moved to hardware custody, never
    reach `ensureDeviceKey`.
  - A missing `@napi-rs/keyring` native binding is a **packaging** defect, not a host property, and it
    silently downgrades every credential to plaintext. `verify-artifacts.mts` fails the release on it.
- **`daemon.db`** — better-sqlite3 session/workspace registry (`session-store.ts` / `workspace-store.ts`,
  tables in `src/db/schema.ts`). The zod `SessionRecordSchema` is the contract: rows are re-validated
  through it on load; the table is just storage. After editing `src/db/schema.ts`, run
  `pnpm -F @linkcode/daemon exec drizzle-kit generate` and commit `drizzle/` — migrations run at boot.
  - **A record field with no column is dropped in silence.** The store enumerates columns on write and
    rebuilds the record on read, so an `.optional()` field added to the schema alone survives until the
    next boot and then parses cleanly as `undefined`. Adding one is three edits (column, write, read)
    plus a migration, and the engine's `InMemorySessionStore` cannot catch a missed one — only a
    round-trip through this store can (`__tests__/session-store.test.ts`).
- **`runtime.json`** — endpoint discovery (`{name,pid,startedAt,listeners:[{type,url}]}`), written
  `0600` only AFTER every listener binds and removed on graceful `SIGINT`/`SIGTERM` shutdown.

## Ports & one-per-profile

- Default listener is `socket.io` on `127.0.0.1:daemonBasePort(channel)` — release **19523**
  (`0x4C43` = ascii `'LC'`, `DAEMON_DEFAULT_PORT`), development **19533**. `LINKCODE_PORT` /
  `LINKCODE_HOST` override every listener. On `EADDRINUSE` a listener hunts **upward** through its
  own channel's span only (release 19523–19532, development 19533–19542); clients must read
  `runtime.json`, never assume a port.
- **The ranges are disjoint for a reason that outlives the `channel` field.** That field cannot
  protect against a daemon shipped before it existed: such a peer parses a newer identity through a
  schema lacking the key, zod strips it, and its profile-only comparison then reads two default
  profiles as equal — so an installed old release exits 3 against a development daemon holding its
  port, and its supervisor stands down. Keeping the channels off each other's ports is the only fix
  that reaches already-shipped binaries. Never widen a span into the neighbouring range.
- **One daemon per universe (channel × profile)**, enforced by the daemon (not the desktop supervisor): `main()` calls
  `findRunningDaemon()` — parse the profile's `runtime.json` → pid alive? → `GET /linkcode` identity
  pid matches? A live one makes the new process log `already running (pid N)` and `process.exit(3)`
  (`DAEMON_EXIT_ALREADY_RUNNING`) — an **explicit** exit because Electron's `utilityProcess` keeps the
  parent IPC channel and the event loop alive forever. The identity (and `runtime.json`) carries
  optional `profile` and `channel` fields (absent = default profile / release, which is what every
  pre-split daemon is): the port hunt treats a live daemon of **another** universe as a port
  neighbor and hunts past it. Across channels the disjoint ranges already keep them apart, so this
  comparison mainly covers profiles and a `LINKCODE_PORT` that forces two channels onto one port.
  Health: `curl http://127.0.0.1:19523/linkcode` (release), `:19533` (development).

## Packaging: spawn, binaries & bundle

- **`installAsarSpawnFix()` is the FIRST line of `main()`** (`src/asar-spawn.ts`). Symptom it fixes:
  `spawn ENOTDIR` launching an agent in the packaged app — Electron rewrites asar paths for
  `execFile`/`fork` but not raw `spawn`, so spawning an `app.asar/…` path traverses the asar file as a
  directory. The patch rewrites `/app.asar/` → `/app.asar.unpacked/` when the unpacked copy exists,
  then `syncBuiltinESMExports()` so SDKs that `import { spawn }` see it. No-op outside Electron.
  **Never guess a spawnable path by walking parents or from `node_modules`** (a tsup bundle sits at a
  different depth than `tsx` src) — hand it in via env, and keep real executables unpacked (`asarUnpack`).
- **Agent binaries do not ship in the app (CODE-114); the daemon provisions them (CODE-111).**
  claude/codex resolve via the runtime probe (`packages/host/agent-adapter/src/probe/`): managed
  install from the daemon's asset store (`@linkcode/assets` — platform data dir, e.g.
  `~/Library/Application Support/LinkCode/assets`, `LINKCODE_ASSETS_DIR` override for tests/E2E;
  SDK-pinned exact pair, SRI-verified, GC'd at boot) → detected user install (the daemon's PATH,
  then fallback locations like brew and `~/.local/bin`; version-verified) → SDK self-resolution from node_modules
  (dev/standalone). **The first managed download is always user-prompted** (CODE-221): boot
  auto-refreshes only agents with a prior install in the asset store (standing consent — GC
  retains superseded versions until the replacement lands, so an offline refresh failure keeps
  retrying on later boots); an agent never installed there waits for the client's explicit
  `asset.ensure` (the onboarding Download card). Boot never waits on a download either way — nor
  on the probe itself (CODE-225): listeners bind while `collect()` is still spawning CLIs, and
  the engine seeds from the pending promise, holding `agent-runtime.list` replies and live
  session starts until it lands. The engine must be constructed **before** that refresh loop
  kicks off —
  it subscribes to the AssetManager and forwards install progress to clients
  (`asset.progress`/`asset.settled`), re-probing and pushing `agent-runtime.changed` when an
  agent install completes (CODE-112). opencode spawns `opencode serve` from the probe-resolved
  binary (managed `agent:opencode` asset → detected user install, CODE-76; bare-name PATH
  fallback for unprobed hosts); pi runs in-process and spawns nothing — its SDK is a managed npm-closure download
  (CODE-219): packaged apps exclude the closure from node_modules and the adapter imports the
  store's installed entry (`agentRuntimeProber.resolveEntry`), same consent/refresh rules.
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
  distinct from the desktop bundle: it targets **plain Node** (still a **same-platform** artifact — the
  napi-rs optional deps and @sentry's profiler resolve host-only — build per target), and it prunes
  the host-arch agent CLI platform packages (the daemon downloads them at runtime via `@linkcode/assets`, as the desktop
  does). The pi npm closure needs no prune (CODE-219): its SDK is a devDependency of
  agent-adapter, so the `--prod` deploy never materializes it — the daemon downloads the managed
  closure on first use.
  Terminals need `LINKCODE_PTY_SIDECAR_PATH` pointed at a built `linkcode-pty`, else they degrade.
  The package `files: ["dist", "drizzle"]` keeps the deploy (and any pack) to runtime files only —
  no `src`/configs — while the `dependencies` field still drives the full runtime closure; this is
  also why the standalone dir carries no test files for the root vitest runner to pick up.

## Engine wiring, errors & lifecycle

- **Injection over imports.** `makeEngineLayer` receives daemon-owned implementations
  (`ProviderConfigStore`, `SessionStore`, `WorkspaceStore`, `PtyBackend`) and owns Engine
  start/stop; defaults stay in-memory so package tests need no daemon. New persistence: interface in
  `@linkcode/engine`, implementation here.
- **Wire version:** every message pins `v: z.literal(WIRE_PROTOCOL_VERSION)`
  (`packages/foundation/schema/src/wire/index.ts`); a version mismatch means silent frame drops — see root
  `AGENTS.md`, Invariant 1. Any wire change bumps the literal; after a bump, rebuild and restart the
  daemon and every client.
- **Process safety:** `uncaughtException` logs `[linkcode/daemon] uncaught exception:` then
  `process.exit(1)` (state untrustworthy); `unhandledRejection` logs
  `[linkcode/daemon] unhandled rejection:` and keeps running — a rejection reaching it is a missed
  `.catch` to fix. **No fire-and-forget on data-plane paths**: await inside try/catch and log, and move
  user-visible side effects after the awaited op succeeds. Full bug catalog → `docs/DEVELOPMENT.md`.
- **Lifecycle:** boot/shutdown is an Effect v4 layer graph in `src/index.ts` (CODE-244; Effect is
  beta-pinned and bundled — root `AGENTS.md` "Never Guess" applies before touching it): layers
  acquire in order Shared (config, double-start gate, hub) → EngineService → Listeners → lifecycle
  (runtime file, then uplink) and release LIFO, so `ensureChatWorkspace(~/LinkCode)` still runs
  **before** any listener binds and `workspace.list` always includes the "Chats" workspace. SIGINT/SIGTERM interrupt the
  root fiber at any boot phase and unwind exactly the layers acquired; exit codes: graceful drain
  `0`, already-running `3` (`DAEMON_EXIT_ALREADY_RUNNING`), anything else `1`. A hung drain
  force-exits after 10s, as does a second signal. A host terminal survives while any local
  or relay-virtual connection retains an attachment; the Hub turns connection loss into detach, and
  the terminal is reaped 60s after its last attachment leaves. Reattaching within the window cancels
  the reap. Session/managed terminals keep their owner's lifecycle instead.

## Pointers

- **Client dial models differ:** desktop discovers via `runtime.json` + fs-watch (follows a port-hunted
  daemon); the webview uses a fixed URL and cannot follow a moved port (detail in `apps/desktop` / `apps/webview`).
- Ordered "daemon/agent won't start" triage, log locations, and DB reset → **`docs/DEVELOPMENT.md`**.
- Agent adapter invariants (SDK↔CLI lockstep, per-agent quirks) → **`packages/host/agent-adapter/AGENTS.md`**.
