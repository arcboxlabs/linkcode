# apps/desktop — Electron shell

Electron app: `src/main` (main process, Node), `src/preload` (context-isolated bridge),
and `src/renderer` (the Vite + React Router renderer). The renderer connects to the
`daemon` over `transport`, exactly like webview; the front-end conventions in
[`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) govern `src/renderer` —
read them when touching the renderer. The rules below are desktop-only — the **system plane**.

- **System plane = TypeSafe IPC only** (`@linkcode/ipc`; tRPC is the default impl). IPC carries window / OS / native-UI operations between main and renderer — **never business data**. Sessions, agent events, and everything in `@linkcode/schema` travel over the `transport`, never over IPC.
- **Main vs renderer.** `src/main/**` is Node — no coss-ui / React conventions apply there. Only `src/renderer/**` is the SPA the front-end rule governs.
- **The preload bridge stays dependency-light.** `src/preload/index.ts` wires `@linkcode/ipc/electron-renderer` over electron's `contextBridge`/`ipcRenderer` and nothing more; do **not** pull heavy runtime deps (e.g. `zod`) into the context-isolated preload. Verify any preload/IPC change by actually running the desktop app — type-checking alone won't catch a broken bridge.
- **Desktop owns only desktop integration.** Keep native chrome, traffic-light/backdrop behavior, desktop-only layout adapters, desktop transport construction, and `SystemBridge` reads here. Move reusable workbench/sidebar/chat presentation to `packages/ui`; move data-plane/runtime containers to `packages/workbench`.
- **Pass system data down as props.** If shared UI needs app version, platform, file paths from a picker, or another system-plane value, read it once in desktop and pass a plain value/callback to shared code. Do not keep a whole component in desktop just because one prop comes from IPC.
- **Use Electron/Node as the system source of truth.** Platform checks should come from main-process `process.platform` through `SystemBridge`, not renderer browser heuristics such as `navigator.platform`.
- **Do not import app code from desktop renderer through another app.** Desktop may depend on `packages/workbench` and `packages/ui`; it must not import `@linkcode/webview` to reuse app roots, providers, transports, or shells.
