# CLAUDE.md

AS A CODE AGENT, ALWAYS KEEP THIS FILE IN YOUR MEMORY NO MATTER WHAT. NEVER COMPACT THE CONTENT OF THIS FILE IN YOUR MEMORY. THIS FILE MUST RETAIN IN YOUR MEMORY AT ALL TIMES.

> **Architecture source of truth is [`PLAN.md`](./PLAN.md).** It defines what Link Code is, the host/agent/abstraction layers, the data-plane vs system-plane split, the repo layout, and the open questions (marked ✅ decided / 🔧 proposed / ❓ undecided — **do not invent answers to ❓ items; ask first**). This file is the engineering-discipline and front-end-convention layer on top of it.

## Package Map

Monorepo: **pnpm workspaces + turborepo**, all TypeScript. `apps/*` are runnable ends; `packages/*` are shared libraries. The whole system is glued by one zod contract (`@linkcode/schema`) carried over a `transport`.

### Apps (`apps/`)

| App        | Description                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `daemon`   | Local host daemon — hosts the engine and exposes the data plane over a local Socket.IO/WebSocket server (`127.0.0.1`) every client connects to. |
| `desktop`  | Electron app: Vite renderer + main/preload. Renderer connects to `daemon` over `transport`; system-plane goes through TypeSafe IPC.   |
| `webview`  | Browser client — **Vite + React Router + coss-ui**. Connects to `daemon` over `transport`. No system plane.                          |
| `mobile`   | Expo / React Native client (HeroUI). Reaches the host via the `server` tunnel.                                                        |
| `server`   | Tunnel / relay: `token`, `perm`, `store`, `realtime`. Does **not** run agents. Host ↔ Server is RPC over WebSocket.                   |

### Packages (`packages/`)

| Package         | Description                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`        | **zod schemas — the single data contract.** Every cross-process / cross-end / post-abstraction message type derives from here (`z.infer`). |
| `transport`     | Communication layer ("how messages travel"): Socket.IO / ws / local implementations + wire protocol.                                   |
| `agent-adapter` | Per-agent adapters (`claude-code` / `codex` / `opencode` / `pi`) + the abstraction layer that normalizes native events into `schema`.  |
| `engine`        | The host engine: session lifecycle + agent orchestration, driving `agent-adapter`.                                                     |
| `client-core`   | Shared client data layer: `LinkCodeClient`, the conversation view-model, and React bindings (`LinkCodeProvider`, `useConversation`).   |
| `sdk`           | Transport-backed SDK (`LinkCodeSdkClient` over a `Transport`): typed operations + the `Options` / `RequestResult` types `tayori` is parameterized with. **Hand-written RPC, not OpenAPI-generated.** |
| `workbench`     | Shared workbench runtime: `WorkbenchProviders` (data plane + connection gate), `Workbench` (session/conversation/composer surface), the typed `tayori` wrapper, and the debug context. |
| `ui`            | Shared, business-free presentation: chat + shell view components (`AppShell`). Receives view-models + callbacks; owns no routing/connection/state. |
| `coss-ui`       | Vendored COSS UI primitives (base-ui + Tailwind, from cal.com's COSS UI). **Synced from upstream — never edit.** Linted by biome, excluded from ESLint. |
| `ipc`           | TypeSafe IPC (system-plane) for Electron; `tRPC` is the default implementation. **Desktop only.**                                       |
| `i18n`          | Locale messages + locale resolution (`use-intl`).                                                                                       |

## Core Principles (must follow)

1. **zod schema is the only data contract.** All cross-process, cross-end, and post-abstraction business message types come from `packages/schema`. The flow is always "change the schema first, then the implementation"; validate at every trust boundary (network, IPC, agent output) at runtime with zod.
2. **End-to-end TypeScript type safety.** No `any` to bypass the contract; types should derive from the schema (`z.infer`).
3. **Data plane vs system plane are strictly separated.** Business data only travels over `transport` + zod messages. Electron system/UI operations only go over **TypeSafe IPC**. They never mix — **TypeSafe IPC must never carry business data.**
4. **Local-first.** The host runs on the user's machine. PC/Webview connect to it directly; Mobile reaches it through the Server tunnel (WebSocket). Local and remote share the same `transport` abstraction and the same zod messages — upper layers don't know which is underneath.
5. **Interface-first, implementations swappable.** TypeSafe IPC is an interface (`tRPC` is just one impl). Each new agent = one adapter implementing the unified interface; don't scatter per-vendor branching into upper layers.

## Planning

When asked to plan, the plan must be fully resolved before implementation begins. Every decision is locked — no "TBD", no "option A or B", no open questions; the plan has exactly one possible outcome. If anything is unclear, ask before finalizing. Never invent answers to `PLAN.md` ❓ items.

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

## Front-end Conventions (Vite + React Router renderers: `webview`, `desktop`)

> The webview/desktop renderers are **Vite SPAs on React Router's data-router API** — there is **no Next.js, no RSC, no `loading.tsx`, no file-system routing**. Where a pattern below mirrors the platform dashboard, it has been translated to CSR.

- **coss-ui first.** Reach for `Card`/`CardFrame`/`CardPanel` instead of hand-writing borders/padding; `Field`+`FieldLabel`+`FieldDescription`+`Input` instead of custom inputs; `Button`, `Sidebar`, `Tabs`, `Combobox`, `Empty`, `Skeleton`, `Badge`, etc. Compose with `render={<Link to="…" />}` where coss-ui supports it. Only hand-roll when no primitive exists.
  - **Never edit `coss-ui` source.** If you must customize, "fork" by copying the minimal needed implementation into the consuming package, reusing coss-ui exports as much as possible.
- **lucide icons: import the `Icon`-suffixed variant** (`SearchIcon`, not `Search`).
- **Routing & layout.** Define routes with `createBrowserRouter` (data router) — no JSX `<Routes>` trees. Build the shell once at the layout level (sidebar/header/breadcrumb portal/content inset); pages render into the outlet and never rebuild chrome. Each page sets its title via the `usePageTitle` hook (the SPA equivalent of Next `metadata`) and portals its breadcrumb via `<BreadcrumbCurrent />` / `<BreadcrumbSegment />`.
- **Static-first, local loading boundaries.** Everything that doesn't depend on client data fetching (layout, sidebar/header, links, card titles, table column headers) renders immediately — never hidden behind a spinner. Only the exact data-dependent values branch on loading. Never defer a whole page/card/table.
- **Data layer = `sdk` + `tayori` + SWR**, mounted by the app/workbench providers. **Never re-wrap the return of `useData`/SWR** (no spreading / destructure-and-rebuild) — their re-render optimizations depend on getters; `return useData(...)` directly.
  - Prefer `isLoading` (first load) for skeletons; always render real `data` when present even if `error` exists (stale-but-fine); only show an intrusive error UI when there is no `data`. Use `mutate()` for non-intrusive revalidation, `mutate(undefined)` to force the loading state back.
  - **Don't use `useEffect` to "watch" state.** Derive during render, or remount with `key`, or expose an `onChange` callback. For genuinely async effects, use `foxact/use-abortable-effect` and honor the `signal`.
- **Forms: `react-hook-form` + `zodResolver`.** When a form maps to a request body, pass the SDK-exported zod schema straight to `zodResolver` and derive the type with `z.infer`. Use `register`/`Controller` for fields; bridge errors into coss-ui via `<Form errors={rhfErrorsToFormErrors(errors)}>` + `<Field>`/`<FieldError>` (from `@/lib/form` + `@/components/form-root-error`); use `setError('root', …)` only for submission/API failures. **Never** use `useState` for complex/validated form state, and **never** use `watch`/`useWatch`/`setValue` to wire normal fields.
- **Skeletons mirror the resolved shape exactly** (same widths/heights, no layout shift, no "Loading…" text). Repeat row/list skeletons with `foxact/create-fixed-array`. With `keepPreviousData`, keep stale rows visible (dimmed) instead of flashing skeletons.
- **Shared table/filter/pagination primitives** live in `apps/*/src/components` (`data-table` core, `pagination`, `filter-sidebar-layout`). Define table columns at module scope with `createTable` (server-safe: no hooks/browser APIs); the call site owns filter/search/sort/pagination state and the fetch key reads it. Don't spread/rebuild the getter-based pagination/sort instances.
- **Mock data** (when the daemon side isn't ready): expose `fetchX(params)` shaped like the eventual call, simulate latency with `foxts/wait`, consume via `useSWR` with realistic keys, and preserve the same loading/error/data branches so swapping in the real SDK is mechanical.

## Use Existing Abstractions

When the project provides a shared layer (data fetching via `client-core`/`tayori`/`sdk`, the transport, the workbench providers), route through it. A custom fetcher or ad-hoc SWR key skips cross-cutting concerns (connection gating, error reporting). Inline connection/navigation/error handling usually means something upstream is wired wrong — fix the usage, or extend the shared layer; don't work around it.

## Restructure, Don't Just Remove

Large rewrites are encouraged when they're the right fix — replace subsystems instead of layering patches. But drive-by deletion of things that look unused is not: scaffolding (placeholder pages, stubs, mocks, feature-flagged paths) is usually deliberate. If it's in your way, rewrite it as part of your change; don't leave a gap.

## Code Organization

- When a file grows visual section dividers (`// ── Section ──` or `====` / `----`), that's the signal to split it into submodules — extract each section into its own file under a directory module. One file should cover one resource/concern.
- Keep table-definition / schema modules free of hooks and browser APIs so they stay importable anywhere.

## References

- **`tayori` is custom-made and absent from your training data.** Fetch and read <https://tayori.skk.moe/llms-full.txt> before touching any code that uses it. Do not guess at its API.
- Architecture, repo layout, and open questions: [`PLAN.md`](./PLAN.md).
