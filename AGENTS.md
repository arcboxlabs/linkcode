# AGENTS.md

> **Architecture source of truth is [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).** It defines what LinkCode is, the host/agent/abstraction layers, the data-plane vs system-plane split, the package map, the core principles you must follow, the key contracts, and the open questions — **do not invent answers to the open questions; ask first**. This file is the engineering-discipline layer on top of it.

## Planning

When asked to plan, the plan must be fully resolved before implementation begins. Every decision is locked — no "TBD", no "option A or B", no open questions; the plan has exactly one possible outcome. If anything is unclear, ask before finalizing. Never invent answers to the open questions in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Change Discipline

- Only change what is explicitly requested. Do not "improve", restructure, replace, or simplify adjacent code you weren't asked to touch. Reducing your edit to a reasonable scope helps you stay focused.
  - **NEVER re-create a file from scratch. NEVER use `sed`/`awk` to edit a file. Always use targeted, localized edits.** This avoids introducing unrequested changes or silently dropping things that were already there.
- Commit messages: `type(scope): summary` (e.g. `fix(transport): drop stale ack on reconnect`). **No `Co-Authored-By` lines.** Keep them simple. If you feel the need to explain something in a commit message, **don't** — put the explanation in a code comment instead.
- Keep each commit atomic — compilable and runnable. Target ~200 lines changed (excluding generated files); hard limit 400. Don't make commits too small either — group related changes into one coherent commit. Commit along the way, not all at the end.
- **Formatter, linter, and type checker must pass before commit** (`pnpm lint`, `pnpm typecheck`, `pnpm format`) — pre-commit hooks don't cover everything.
- Use the package manager for dependency changes (`pnpm add`), not manual manifest edits. Cut releases via the repo's release flow; never hand-tag or hand-edit workspace versions.

## Tooling

- **pnpm only**, never `npm` / `npx`. Prefer existing npm scripts (e.g. `pnpm -F @linkcode/webview run lint`) over invoking binaries directly.
- **Lint = ESLint (`eslint-config-sukka`); format = Biome (its linter is disabled — Biome only formats).** Don't fix lint by hand first; finish the task, then run `pnpm lint:fix` and re-check — most issues auto-fix. `packages/coss-ui` is the one exception (linted by biome, ignored by ESLint).
- React Compiler is enabled on the Vite renderers — write code that satisfies its rules (no manual `useMemo`/`useCallback` gymnastics that fight it; keep components pure).

## Use Existing Abstractions

When the project provides a shared layer (data fetching via `client-core`/`tayori`/`sdk`, the transport, the workbench providers), route through it. A custom fetcher or ad-hoc SWR key skips cross-cutting concerns (connection gating, error reporting). Inline connection/navigation/error handling usually means something upstream is wired wrong — fix the usage, or extend the shared layer; don't work around it.

## Ownership Boundaries

Use dependency direction to decide where code belongs; do not place a file by the app that first needed it.

- `apps/*` are runnable ends, not shared libraries. One app must not import another app to reuse providers, routing, transports, or UI. Shared app/runtime glue belongs in `packages/workbench`; shared presentation belongs in `packages/ui`.
- `apps/desktop` owns Electron-only concerns: main/preload, `SystemBridge` calls, native window/chrome behavior, desktop transport construction, and desktop-specific shell layout integration. If a component only needs one desktop value, read that value at the desktop boundary and pass it down as a prop; do not keep the whole component in desktop.
- `apps/webview` owns the browser entry and browser transport construction. It has no system plane and no Electron fallback path.
- `packages/workbench` owns the client runtime/data plane: `client-core`, `sdk`, `tayori`, SWR, transport-backed containers, session orchestration, and runtime providers.
- `packages/ui` owns business-free React presentation. It may consume schema/view-model types and callbacks, but it must not import `client-core`, `sdk`, `transport`, `tayori`, app packages, or Electron IPC.
- `packages/common` is for framework-agnostic utilities only. Do not move UI, hooks tied to React renderers, or product behavior there.

When moving code across a boundary, move the dependency with the responsibility: keep system-plane reads at desktop edges, data-plane reads in workbench, and pure rendering in UI.

## Restructure, Don't Just Remove

Large rewrites are encouraged when they're the right fix — replace subsystems instead of layering patches. But drive-by deletion of things that look unused is not: scaffolding (placeholder pages, stubs, mocks, feature-flagged paths) is usually deliberate. If it's in your way, rewrite it as part of your change; don't leave a gap.

## Code Organization

- When a file grows visual section dividers (`// ── Section ──` or `====` / `----`), that's the signal to split it into submodules — extract each section into its own file under a directory module. One file should cover one resource/concern.
- Keep table-definition / schema modules free of hooks and browser APIs so they stay importable anywhere.
- Directory names must describe responsibility, not incidental data. For example, a sidebar footer belongs with sidebar/workbench presentation, not in a `host/` folder just because it displays host state; a layout adapter belongs under layout, not a one-file pseudo-subsystem.

## Tooling And Aliases

- Keep configured path aliases such as `@renderer/*` when they express a project boundary or renderer root. If IDE ESLint cannot resolve an alias but CLI TypeScript/lint can, fix the resolver/tooling configuration instead of rewriting imports to work around the IDE.
- Prefer authoritative platform/system values from the owning runtime. In Electron, use main-process `process.platform` exposed through the system plane; do not infer desktop OS from browser APIs such as `navigator.platform` in the renderer.

## References

- **`tayori` is custom-made and absent from your training data.** Fetch and read <https://tayori.skk.moe/llms-full.txt> before touching any code that uses it. Do not guess at its API.
- **`foxts` helpers can have non-obvious defaults — check the real signature, not the lodash-alike name.** `foxts/once` *prewarms* by default: `once(fn)` executes `fn` immediately and caches the result; call-at-most-once semantics require `once(fn, false)`. The prewarm default has already shipped a daemon that shut itself down right after boot and transports whose `onClose` never fired — when adopting a foxts helper, read its `.d.ts` (or source) first.
- Architecture, package map, core principles, and open questions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- Front-end (renderer) conventions live in [`.claude/rules/frontend.md`](.claude/rules/frontend.md) — read it when working in `apps/webview` or the `apps/desktop` renderer. Each app and shared package also carries its own `AGENTS.md`.
