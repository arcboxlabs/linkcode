# packages/ui — shared presentation (multi-platform)

Business-free view components (chat + shell) consumed by every client. Split by platform
— keep the halves apart:

- `src/chat/**`, `src/shell/**` — **web** (coss-ui + React DOM). [`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) applies here.
- `src/native/**` — **React Native**, consumed by `apps/mobile`. No coss-ui, no DOM.
- Never cross-import web ↔ native. Components receive view-models + callbacks and own no routing, connection, or state.
