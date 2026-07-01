# apps/daemon — the local host process

Standalone Node process (no browser APIs, no React): constructs the `Engine`, hosts the agent
adapters and the PTY sidecar, and serves the data plane to every client over the transport.
Runs via `tsx` in dev (`pnpm -F @linkcode/daemon dev`) and a `tsup` bundle in prod.

- **State lives in `~/.linkcode/`.** `config.json` (listeners + provider config, written `0600`)
  and `daemon.db` (SQLite session registry). Paths are owned by `src/config.ts` — don't scatter
  `homedir()` joins elsewhere.
- **Session registry = drizzle over better-sqlite3** (`src/session-store.ts`, tables in
  `src/db/schema.ts`). The zod `SessionRecordSchema` stays the contract: rows are validated back
  through it on load; tables are just the storage shape. After editing `src/db/schema.ts`,
  regenerate migrations with `pnpm -F @linkcode/daemon exec drizzle-kit generate` and commit the
  `drizzle/` output — migrations run automatically at boot.
- **Injection over imports.** The engine receives daemon-owned implementations
  (`ProviderConfigStore`, `SessionStore`, `PtyBackend`) at construction; engine defaults stay
  in-memory so bare engines and tests need no daemon. New persistence follows the same shape:
  interface in `@linkcode/engine`, implementation here.
- **The PTY sidecar is a Rust binary** (`pnpm -F @linkcode/daemon run build:rust`); terminal
  support degrades cleanly when it is absent.
