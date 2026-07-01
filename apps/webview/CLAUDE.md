# apps/webview — browser client

Vite + React Router SPA that runs in the browser and connects to the `daemon` over
`transport`. The front-end conventions in
[`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) apply here and load
automatically.

- **No system plane.** There is no Electron and no TypeSafe IPC in webview — it is browser-only. Everything, data included, travels over the `transport` to the daemon. An OS / window / native capability has no home here; if you reach for one, it belongs in `apps/desktop`.
