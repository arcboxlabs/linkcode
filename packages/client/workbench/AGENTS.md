# packages/client/workbench — shared client runtime

Shared workbench runtime and feature surface consumed by desktop and webview. This package sits between
app-specific entries (`apps/desktop`, `apps/webview`) and pure presentation (`packages/presentation/ui`).

- **Own the data plane runtime.** `client-core`, `sdk`, `tayori`, SWR, transport-backed containers,
  conversation/session orchestration, and workbench providers belong here.
- **No system plane.** Do not import `@linkcode/ipc`, Electron, preload/main code, or desktop app modules.
  If desktop-only system data is needed by a workbench surface, accept it as props from `apps/desktop`.
- **Do not become presentation-heavy.** Reusable DOM presentation belongs in `packages/presentation/ui`; workbench should
  pass view-models, callbacks, or small runtime-backed component adapters into UI.
- **Apps are consumers, not dependencies.** Never import from `apps/webview` or `apps/desktop`. Shared app
  roots/providers that both apps need belong here.
- **Tayori is custom.** Read <https://tayori.skk.moe/llms-full.txt> before changing code that depends on
  tayori APIs; do not guess at its behavior.

## Source layout

`src/` is grouped by concern — place new code by which concern owns it:

- `app/` — the composition layer apps mount: global UI providers (toast + i18n), the data-plane
  providers + connection gate, and the default connection-state fallback.
- `runtime/` — the connection layer, `WorkbenchRuntimeProvider` and its hooks, the typed
  tayori instance, and the debug toggles. The controller mechanics (endpoint resolution,
  client generations, close recovery, retry) live in `@linkcode/client-core`'s
  `ConnectionController`, which is generic over any client exposing
  `connect`/`onClose`/`dispose` so `apps/mobile` shares them; `connection-controller.ts` here is
  the workbench **binding** — it pins the generic to `LinkCodeSdkClient`, promotes each
  generation into the ambient default tayori reads (`setDefaultClient`), and reports outcomes to
  product analytics. Behavior changes belong in client-core; only SDK/analytics wiring belongs here. SWR retains cached data across generations of the same
  endpoint, starts a fresh cache after endpoint migration, and revalidates once after a generation
  becomes protocol-ready; it does not own connection state.
- `surface/` — the workbench feature surface: the `Workbench` component, the `WorkbenchShell*`
  contract plus the default shell, and session orchestration hooks. `use-seeded-conversation.ts`
  seeds the active thread through client-core's `readConversationSeed` (the turn-graph projection
  where the host serves one, the provider transcript otherwise — rules in
  `packages/client/core/AGENTS.md`), answers a store's resync request with SWR `mutate()`, and
  persists both seed shapes through `seed-cache.ts` for the instant repaint on reopen. Version
  browsing (`‹ 1/N ›`) is `lineage-store.ts` (non-persisted zustand: the parked leaf per session,
  remembered descent per parent) + the pure helpers in `lineage.ts` + `use-conversation-graph.ts`
  (the turn tree, revalidated on `conversation.graph.changed`). The seed hook keeps a stable SWR
  key and reads the parked leaf at fetch time — a version switch revalidates in place instead of
  flashing an empty timeline — and freezes the store (`followLive: false`) while the read it holds
  was made toward a parked version the active lineage does not run through (`onActiveLineage`); a
  read of the host default keeps following, and the next graph snapshot re-reads it once the tree
  has moved past it (an edit from any device). A parked view's sends and `/`/`$` inputs are
  explicit-parent `turn.submit`s under the version's last completed turn, an edit is a sibling
  under the edited turn's parent, and a successful submit follows the host default again (the
  daemon moved it before replying); the store also releases a parked view once the default runs
  through its leaf. "Fork a new thread from here" on an agent reply is `session.fork` through that
  turn (`useWorkbenchSessions.fork`, offered only when the host and the harness can fork after a
  turn): the daemon copies the lineage onto a provider-native fork, and this device selects the
  child while the source stays as it was.
- `terminal/` — the daemon-backed interactive terminal: the panel container, the key-scoped
  session registry that retains/detaches (rather than kills) a PTY across remounts, viewer
  attachment containers, and the transport-backed `TerminalSession`. Only the current controller
  forwards input/resize; controller changes must not remount Restty.
- `git/` — daemon-backed git status/PR polling hooks (`useGitStatus`, `useGitPullRequestStatus`)
  and the Diff-section container (`GitPanel`) that assembles them for `packages/presentation/ui`'s
  `GitOverview`.
- `palette/` — the ⌘K command palette's client state: `useCommandPaletteStore` (`open`/`toggle`/`setOpen` + imperative `openCommandPalette()`, and `commandsByOwner` keyed by owner so a surface registers/unregisters only its own commands via `registerCommands`/`unregisterCommands`) plus a sibling pure-function `match` module. Plain **non-persisted** zustand — no `zodPersist`; there is no `cmdk` dependency (the UI renders through coss-ui's `command` component).
- `lib/` — small framework-adjacent utilities shared by both apps' forms, e.g.
  `rhfErrorsToFormErrors` (react-hook-form `FieldErrors` → coss-ui `<Form errors>` shape) and the
  zod human-readable error map it activates as a side effect. Exported only through the `./form`
  subpath (not the root barrel) so that global zod side effect only fires for consumers that
  actually import a form util, not for every `@linkcode/workbench` import.
- `sidebar/` — the flattened thread-group sidebar's data layer: `groupThreadsByWorkspace` (grouping/
  sort) and `selectVisibleSessions` (per-group preview truncation, both unit-tested pure functions),
  `useSidebarGroupCollapseStore` (the persisted, cwd-keyed collapse state),
  `useSidebarPinStore` (persisted pinned-thread membership), `useSidebarOrderStore` +
  `ordering.ts` (persisted manual drag order for groups and threads, plus the unit-tested pure
  ordering/drop helpers), and the hook-backed
  adapter components (`RuntimeBranchStatus`, `RuntimeWorkspaceHistory`) that give `packages/presentation/ui`'s
  `SessionSidebar` a per-group/per-row git-status or history subscription without it touching
  tayori. `surface/workbench.tsx` combines all of this into the `ThreadGroupViewModel[]` (grouping +
  visibility + collapse/preview/history-open flags) that flows into the shell as plain props.

The public API is the root barrel (`src/index.ts`) plus the `./tayori` and `./form` subpaths
(pinned in `package.json` `exports`). Consumers never deep-import other paths — export new modules
through the barrel, and don't add subpaths without need. `./form` is not also re-exported from the
barrel: `lib/form.ts` activates a global zod error-map side effect on import, so keeping it off the
barrel means only consumers that actually import a form util pay for it, instead of every
`@linkcode/workbench` consumer.
