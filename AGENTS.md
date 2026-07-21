# AGENTS.md

> **Architecture source of truth is [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — what LinkCode is, the host/agent/abstraction layers, the data-plane vs system-plane split, the package map, the core principles you must follow, the key contracts, and the **open questions you must never answer yourself; ask first**. The runbook (prerequisites, running the apps, tests, E2E, triage) is [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md); release/signing/notarization/update-feed is [`docs/RELEASE.md`](docs/RELEASE.md). This file is the always-loaded discipline + routing layer on top of them.

## Invariants — ranked by blast radius

Each of these breaks the product, a release, or the build with **no loud error**.

1. **Wire-protocol versions are lockstep.** `WIRE_PROTOCOL_VERSION` (currently 41) is a `z.literal` in `packages/foundation/schema/src/wire`; any change to any wire variant must bump it. Mismatched peers still complete the socket ("connected") but every frame fails validation and is **silently discarded** — zero messages, a hang-like failure. Rebuild and restart the daemon and every client together.
2. **`foxts/once` prewarms by default.** `once(fn)` runs `fn` immediately at construction and caches the result; call-at-most-once semantics need `once(fn, false)`. The default has already shipped a daemon that ran its shutdown at boot and transports whose close-callback fired at construction. Read any foxts helper's `.d.ts`/source before adopting it — the lodash-alike name lies.
3. **Native deps must be allow-listed.** pnpm blocks install scripts by default; a native dep (e.g. `better-sqlite3`) missing from `allowBuilds:` in `pnpm-workspace.yaml` installs fine but fails at `require()` time with missing bindings.
4. **`check:ci` does not run `pnpm test`.** CI runs vitest as a separate TypeScript-job step, while `check:ci` remains format/lint/typecheck only. Run both commands before every commit; passing either one alone is not the complete JavaScript gate.
5. **A release is a version+tag pair.** Bump `apps/desktop/package.json` `version`, then push a `v*.*.*` tag; CI fails unless `v${version}` equals the tag. Never hand-tag or hand-edit workspace versions ([`docs/RELEASE.md`](docs/RELEASE.md)).
6. **Every daemon-side child process sets `windowsHide: true`.** Node defaults it to `false`, and the daemon runs console-less (Electron `utilityProcess`), so a console-subsystem child spawned without it — agent CLI, git, sidecar, bsdtar — pops a visible console window on packaged Windows only; silent everywhere else, dev included. Applies to every `spawn`/`exec*`/cross-spawn call in `apps/daemon` and `packages/host/{engine,agent-adapter,assets}` (CODE-236 swept all sites 2026-07 — keep new ones consistent). SDK-internal spawns are out of reach: claude's SDK hides its own, opencode's `createOpencodeServer` does not.

## Routing — touching X, read Y first

| You're about to… | Read first |
| --- | --- |
| Run, test, E2E, or debug the app locally | [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) |
| Touch the renderer (React, UI, icons, i18n, client state) | [`.claude/rules/frontend.md`](.claude/rules/frontend.md) |
| Touch Electron main / preload / CSP / cloud-auth wiring | [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) |
| Integrate or change an agent (claude-code, codex, opencode, pi), approvals, history | [`packages/host/agent-adapter/AGENTS.md`](packages/host/agent-adapter/AGENTS.md) |
| Work on the daemon: ports, `runtime.json`, spawn, PTY sidecar | [`apps/daemon/AGENTS.md`](apps/daemon/AGENTS.md); triage lives in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) |
| Package, sign, notarize, or publish a release | [`docs/RELEASE.md`](docs/RELEASE.md) + [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) |
| Change the wire protocol, schema, or transport | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) contracts + `packages/foundation/schema` (Invariant 1) |
| Work on mobile (Expo) | [`apps/mobile/AGENTS.md`](apps/mobile/AGENTS.md) |
| Use `tayori` anywhere | fetch <https://tayori.skk.moe/llms-full.txt> first — it is absent from your training data |
| LinkCode Cloud (production API, auth-provider, IM, connectors) | not this repo — the `linkcodehq` repository (see Ecosystem) |
| Anything else in an app or package | that directory's own `AGENTS.md` |

## Planning

When asked to plan, the plan must be fully resolved before implementation begins. Every decision is locked — no "TBD", no "option A or B", no open questions; the plan has exactly one possible outcome. If anything is unclear, ask before finalizing. Never invent answers to the open questions in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Change Discipline

- Only change what is explicitly requested. Do not "improve", restructure, replace, or simplify adjacent code you weren't asked to touch. Reducing your edit to a reasonable scope helps you stay focused.
  - **NEVER re-create a file from scratch. NEVER use `sed`/`awk` to edit a file. Always use targeted, localized edits.** This avoids introducing unrequested changes or silently dropping things that were already there.
- Commit messages: `type(scope): summary` (e.g. `fix(transport): drop stale ack on reconnect`). **No `Co-Authored-By` lines.** Keep them simple. If you feel the need to explain something in a commit message, **don't** — put the explanation in a code comment instead.
- Keep each commit atomic — compilable and runnable. Target ~200 lines changed (excluding generated files); hard limit 400. Don't make commits too small either — group related changes into one coherent commit. Commit along the way, not all at the end.
- **Formatter, linter, type checker, and tests must pass before commit** — `pnpm check:ci` (= `format:check` + `lint` + `typecheck`) **and** `pnpm test` (Invariant 4: they remain separate commands). Pre-commit hooks don't cover everything.
- Use the package manager for dependency changes (`pnpm add`), not manual manifest edits. Cut releases via the repo's release flow (Invariant 5); never hand-tag or hand-edit workspace versions.

## Verification

A change isn't done until you've **observed it running** — preload/IPC/bridge edits especially: type-checking cannot catch a broken bridge, a bad spawn path, or a wire mismatch; only driving the real flow can. How to run every surface, scope the tests, drive an E2E, and triage a dead daemon: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Tooling

- **The toolchain comes from devenv** (`devenv.nix`: Node 26, pnpm, Rust, prek hooks). If your shell isn't already inside the environment (direnv), run repo commands as `devenv shell -- pnpm …`. The devenv scripts `app` / `daemon` / `desktop` / `mobile` (defined in `devenv.nix`) are the convenience runners — plain commands inside the devenv shell, or `devenv shell -- app` from outside (there is no `devenv run` subcommand).
- **pnpm only**, never `npm` / `npx`. Prefer existing npm scripts (e.g. `pnpm -F @linkcode/webview run lint`) over invoking binaries directly. pnpm 11 reads install settings from `pnpm-workspace.yaml`, **not** `.npmrc` (which is nearly inert here): `nodeLinker: hoisted`, shared versions under `catalog:`, security `overrides`, native builds under `allowBuilds:` (Invariant 3), and a `minimumReleaseAgeExclude` allowlist that exempts just-released pins from the release-age install policy.
- Turbo wraps only `build`/`dev`/`clean`. Root `pnpm typecheck` is one `tsc --build --noEmit` over the root `tsconfig.json` solution file, which lists every workspace project as a `reference` (package tsconfigs stay `incremental` + `noEmit`, never `composite`, and never reference each other — cross-package imports resolve into dep sources directly). There are no per-package typecheck scripts; check one project with `tsc --build --noEmit packages/<scope>/<name>`. `pnpm lint` is one whole-repo `eslint --format=sukka .` and `pnpm test` is one root `vitest run` — all three bypass turbo, so editing turbo's `lint` task changes nothing. A new workspace package must be added to the root `tsconfig.json` `references` or it is silently unchecked.
- **Lint = ESLint (`eslint-config-sukka`); format = Biome (its linter is disabled — Biome only formats and organizes imports).** Don't fix lint by hand first; finish the task, then run `pnpm lint:fix` and re-check — most issues auto-fix. Biome lowercases hex literals while sukka wants uppercase — write shared constants in decimal. `packages/vendor/coss-ui` is the one exception: vendored, ignored by ESLint **and** excluded from the root Biome config, so upstream formatting is preserved as-synced — never hand-edit or reformat it.
  - A new `*.config.ts` at a package root must be added to that package's tsconfig `include` and kept out of eslint's `allowDefaultProject` globs — typescript-eslint's default project hard-caps at 8 files and rejects files matched by both.
- **prek pre-commit hooks run format/lint/typecheck over the WHOLE repo** on every commit (plus a 512 KB cap on newly added files; Rust is **not** hooked — run `cargo fmt`/`clippy`/`test` yourself). A parallel session's dirty files can therefore fail *your* commit; verify your own files are clean before blaming your change. Hook config lives in `devenv.nix` (never edit the generated `.pre-commit-config.yaml`); stash-recovery for a failed hook run is in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
- React Compiler is enabled on the Vite renderers — write code that satisfies its rules (no manual `useMemo`/`useCallback` gymnastics that fight it; keep components pure).

## Use Existing Abstractions

When the project provides a shared layer (data fetching via `client-core`/`tayori`/`sdk`, the transport, the workbench providers), route through it. A custom fetcher or ad-hoc SWR key skips cross-cutting concerns (connection gating, error reporting). Inline connection/navigation/error handling usually means something upstream is wired wrong — fix the usage, or extend the shared layer; don't work around it.

Before hand-writing any small TS utility (delay/retry/debounce/guard/clamp) or React hook — in product **or** test code — check `foxts` and `foxact` first: the repo has adopted both, and reimplementing an existing helper gets rejected in review.

## Ownership Boundaries

Use dependency direction to decide where code belongs; do not place a file by the app that first needed it.

- `apps/*` are runnable ends, not shared libraries. One app must not import another app to reuse providers, routing, transports, or UI. Shared app/runtime glue belongs in `packages/client/workbench`; shared presentation belongs in `packages/presentation/ui`.
- `apps/desktop` owns Electron-only concerns: main/preload, `SystemBridge` calls, native window/chrome behavior, desktop transport construction, and desktop-specific shell layout integration. If a component only needs one desktop value, read that value at the desktop boundary and pass it down as a prop; do not keep the whole component in desktop.
- `apps/webview` owns the browser entry and browser transport construction. It has no system plane and no Electron fallback path.
- `packages/client/workbench` owns the client runtime/data plane: `client-core`, `sdk`, `tayori`, SWR, transport-backed containers, session orchestration, and runtime providers.
- `packages/presentation/ui` owns business-free React presentation. It may consume schema/view-model types and callbacks, but it must not import `client-core`, `sdk`, `transport`, `tayori`, app packages, or Electron IPC.
- `packages/foundation/common` is for framework-agnostic utilities only. Do not move UI, hooks tied to React renderers, or product behavior there.

When moving code across a boundary, move the dependency with the responsibility: keep system-plane reads at desktop edges, data-plane reads in workbench, and pure rendering in UI.

## Restructure, Don't Just Remove

Large rewrites are encouraged when they're the right fix — replace subsystems instead of layering patches. But drive-by deletion of things that look unused is not: scaffolding (placeholder pages, stubs, mocks, feature-flagged paths) is usually deliberate. If it's in your way, rewrite it as part of your change; don't leave a gap.

## Code Organization

- When a file grows visual section dividers (`// ── Section ──` or `====` / `----`), that's the signal to split it into submodules — extract each section into its own file under a directory module. One file should cover one resource/concern.
- Keep table-definition / schema modules free of hooks and browser APIs so they stay importable anywhere.
- Directory names must describe responsibility, not incidental data. For example, a sidebar footer belongs with sidebar/workbench presentation, not in a `host/` folder just because it displays host state; a layout adapter belongs under layout, not a one-file pseudo-subsystem.
- Terminology: the product term **Thread** is the code/wire term **`session`** — the rename is UI/i18n-only. Never rename `session` in wire or code identifiers.

## Tooling And Aliases

- Keep configured path aliases such as `@renderer/*` when they express a project boundary or renderer root. If IDE ESLint cannot resolve an alias but CLI TypeScript/lint can, fix the resolver/tooling configuration instead of rewriting imports to work around the IDE.
- Prefer authoritative platform/system values from the owning runtime. In Electron, use main-process `process.platform` exposed through the system plane; do not infer desktop OS from browser APIs such as `navigator.platform` in the renderer.

## Ecosystem (external context — not verifiable from this repo; checked against the sibling repos 2026-07)

- **The daemon runs on the user's machine** — `apps/daemon` running `@linkcode/engine`, bound to loopback; desktop/webview/mobile are clients of it. This repo is the clients plus the daemon.
- **LinkCode Cloud is a separate repository, `linkcodehq`**: the production API at `api.linkcode.ai` (Hono on Cloudflare Workers) plus auth, IM, and connectors. Any cloud/server/tunnel/auth-provider work happens there, not here.
- **Central identity is a separate ArcBox service** (`auth.arcbox.dev`); `linkcodehq`'s better-auth is a *client* of it, not the provider.
- Desktop auto-updates read the Cloudflare R2 feed at `releases.linkcode.ai/desktop`; agent CLI binaries do **not** ship in the app (CODE-114) — the daemon spawns a detected user install (runtime probe) or a managed download — detail in [`docs/RELEASE.md`](docs/RELEASE.md) and [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md).

## Process

- Track work as Linear `CODE-xxx` issues and branch per issue (use the issue's `gitBranchName`). Substantial or risky work always gets a branch.
- Merges to master use `--no-ff` `merge:` commits. The master ruleset's review requirements (including a Copilot review) can't always be satisfied, so some merges go through `gh pr merge --admin` — an agent must never self-authorize `--admin`; get explicit user approval each time.
- Release = version bump + `v*.*.*` tag → CI signs and publishes (Invariant 5; [`docs/RELEASE.md`](docs/RELEASE.md)).

## Never Guess — Ask First

- **`tayori` is custom-made and absent from your training data.** Fetch <https://tayori.skk.moe/llms-full.txt> before touching any code that uses it. Do not guess at its API.
- **Effect v4 (the daemon's boot orchestration) postdates your training data.** It was released 2026-02; v3 idioms actively mislead (`Context.Tag` → `Context.Service`, `Schedule.intersect` removed, `Effect.retry` takes an options object, …). Before writing Effect code, load the `effect-ts` skill (its `references/` guides are v4-canonical) and read the installed `.d.ts` under `node_modules/effect`; the skill's source-research prerequisite is a gitignored clone at `.repos/effect` (`git clone https://github.com/Effect-TS/effect-smol .repos/effect`). Repo policy overrides the skill's `effect@beta` install rule: the pin is an exact beta — bump it deliberately, as a small migration (CODE-244).
- **The agent SDKs are fast-moving** (three are 0.x; opencode is 1.x) — read the installed `.d.ts` under `node_modules`, not vendor docs or your training memory, before relying on SDK behavior (`packages/host/agent-adapter/AGENTS.md`).
- **The open questions in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** are genuinely undecided — never invent answers; ask first.

## Known Traps — symptom → owning doc

Fix detail lives in the owning doc, not here.

- `spawn ENOTDIR` launching an agent in the packaged app → [`apps/daemon/AGENTS.md`](apps/daemon/AGENTS.md) (asar-spawn rewrite).
- Packaged build exits 0 silently or throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` at launch, fine in dev → [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) (CODE-101 class).
- Blank first screen after a preload/IPC change → [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) (sandboxed preload `require`).
- `Dynamic require of … is not supported` at daemon boot → [`apps/daemon/AGENTS.md`](apps/daemon/AGENTS.md) (tsup bundle contract).
- `EMFILE` during desktop packaging → [`docs/RELEASE.md`](docs/RELEASE.md).
- Signing dies with `⨯ … not a file` → [`docs/RELEASE.md`](docs/RELEASE.md) (empty `CSC_LINK`).
- Black terminal pane or garbled/ghosted glyphs → [`.claude/rules/frontend.md`](.claude/rules/frontend.md) (restty WASM/CSP/fonts).
- Uncommitted changes vanished after a failed commit → [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) (prek stash recovery).
- Engine git-fixture tests fail or `git push` hangs on a signing machine → [`apps/daemon/AGENTS.md`](apps/daemon/AGENTS.md) (fixtures set `commit.gpgsign=false`).
- Daemon "won't start" / client stuck disconnected → ordered triage in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## References

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture, package map, contracts, open questions. [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — runbook. [`docs/RELEASE.md`](docs/RELEASE.md) — release.
- [`.claude/rules/frontend.md`](.claude/rules/frontend.md) — renderer conventions (auto-applies to `apps/webview` and the `apps/desktop` renderer). Every app and shared package carries its own `AGENTS.md`.
