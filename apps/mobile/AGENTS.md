# apps/mobile — Expo / React Native client

Expo + React Native, UI in **HeroUI** (not coss-ui). Reaches the host through the
`server` tunnel; business data still travels over the `transport` + `@linkcode/schema`,
the same contract as every other client.

- **The web renderer conventions do NOT apply here.** [`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) (coss-ui, `createBrowserRouter`, `sdk`+`tayori`+SWR data-table, `react-hook-form`+`zodResolver`) targets the Vite / DOM renderers — none of it holds for React Native. Use the Expo / RN + HeroUI idioms instead.
- **Shared code:** mobile consumes `@linkcode/ui` only through its **native** components (`packages/ui/src/native/**`), never its coss-ui web parts.
