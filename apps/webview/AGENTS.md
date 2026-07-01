# apps/webview — browser client

Vite + React Router SPA that runs in the browser and connects to the `daemon` over
`transport`. The front-end conventions in
[`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) apply here — read them when
working in this app.

- **No system plane.** There is no Electron and no TypeSafe IPC in webview — it is browser-only. Everything, data included, travels over the `transport` to the daemon. An OS / window / native capability has no home here; if you reach for one, it belongs in `apps/desktop`.
- **Webview is an app, not a shared package.** Do not put reusable app providers, workbench runtime, or desktop-consumed shells here. Shared app/runtime glue belongs in `packages/workbench`; shared presentation belongs in `packages/ui`.
- **Own only browser-specific construction.** Webview may construct its browser transport and browser entry/root, then pass them into `packages/workbench`. It should not know about desktop shell, IPC, preload, Electron, or native window behavior.
