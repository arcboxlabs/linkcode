# packages/workbench — shared client runtime

Shared workbench runtime and feature surface consumed by desktop and webview. This package sits between
app-specific entries (`apps/desktop`, `apps/webview`) and pure presentation (`packages/ui`).

- **Own the data plane runtime.** `client-core`, `sdk`, `tayori`, SWR, transport-backed containers,
  conversation/session orchestration, and workbench providers belong here.
- **No system plane.** Do not import `@linkcode/ipc`, Electron, preload/main code, or desktop app modules.
  If desktop-only system data is needed by a workbench surface, accept it as props from `apps/desktop`.
- **Do not become presentation-heavy.** Reusable DOM presentation belongs in `packages/ui`; workbench should
  pass view-models, callbacks, or small runtime-backed component adapters into UI.
- **Apps are consumers, not dependencies.** Never import from `apps/webview` or `apps/desktop`. Shared app
  roots/providers that both apps need belong here.
- **Tayori is custom.** Read <https://tayori.skk.moe/llms-full.txt> before changing code that depends on
  tayori APIs; do not guess at its behavior.

## Source layout

`src/` is grouped by concern — place new code by which concern owns it:

- `app/` — the composition layer apps mount: the `WorkbenchApp` root, global UI providers
  (toast + i18n), the data-plane providers + connection gate, and the default connection-state
  fallback.
- `runtime/` — transport SDK client lifecycle and data-fetching plumbing: `WorkbenchRuntimeProvider`
  and its hooks, the typed tayori instance, the debug toggles.
- `surface/` — the workbench feature surface: the `Workbench` component, the `WorkbenchShell*`
  contract plus the default shell, and session orchestration hooks.
- `terminal/` — the daemon-backed interactive terminal: the panel container and the
  transport-backed `TerminalSession`.

The public API is the root barrel (`src/index.ts`) plus the `./tayori` subpath (pinned in
`package.json` `exports`). Consumers never deep-import other paths — export new modules through the
barrel, and don't add subpaths without need.
