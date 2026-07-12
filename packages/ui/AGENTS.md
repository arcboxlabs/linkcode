# packages/ui — shared presentation (multi-platform)

Business-free view components (chat + shell) consumed by every client. Split by platform
— keep the halves apart:

- `src/chat/**`, `src/shell/**` — **web** (coss-ui + React DOM). [`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) applies here.
- `src/keyboard/**` — **web-only** keyboard-shortcut registry + hooks (chord matching, labels, owner-based activation; conventions in [`.claude/rules/frontend.md`](../../.claude/rules/frontend.md)). DOM-dependent by design — exported from the root barrel, never from `./native`.
- `src/native/**` — **React Native**, consumed by `apps/mobile`. No coss-ui, no DOM.
- Never cross-import web ↔ native. Components receive view-models + callbacks and own no routing, connection, or state.
- Web UI may import `@linkcode/schema` types and receive view-models/callbacks, but must not import `@linkcode/client-core`, `@linkcode/sdk`, `@linkcode/transport`, `@linkcode/workbench`, `tayori`, app packages, or `@linkcode/ipc`.
- If a component needs data from the daemon, create a container in `packages/workbench` and pass the data/session/callback into UI. Keep daemon-backed terminal, session, or subscription logic out of UI; keep presentation pieces such as `LiveTerminal` and `TerminalBlock` here.
- If a component needs one desktop/system value, keep the component here and pass that value from `apps/desktop`; do not move shared presentation into desktop for a single `SystemBridge` dependency.
