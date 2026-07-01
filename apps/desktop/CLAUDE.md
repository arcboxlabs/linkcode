# apps/desktop — Electron shell

Electron app: `src/main` (main process, Node), `src/preload` (context-isolated bridge),
and `src/renderer` (the Vite + React Router renderer). The renderer connects to the
`daemon` over `transport`, exactly like webview; the front-end conventions in
[`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) govern `src/renderer` and
load automatically here. The rules below are desktop-only — the **system plane**.

- **System plane = TypeSafe IPC only** (`@linkcode/ipc`; tRPC is the default impl). IPC carries window / OS / native-UI operations between main and renderer — **never business data**. Sessions, agent events, and everything in `@linkcode/schema` travel over the `transport`, never over IPC.
- **Main vs renderer.** `src/main/**` is Node — no coss-ui / React conventions apply there. Only `src/renderer/**` is the SPA the front-end rule governs.
- **The preload bridge stays dependency-light.** `src/preload/index.ts` wires `@linkcode/ipc/electron-renderer` over electron's `contextBridge`/`ipcRenderer` and nothing more; do **not** pull heavy runtime deps (e.g. `zod`) into the context-isolated preload. Verify any preload/IPC change by actually running the desktop app — type-checking alone won't catch a broken bridge.
