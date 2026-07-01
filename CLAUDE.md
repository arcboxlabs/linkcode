@AGENTS.md

## Claude Code

Always keep these instructions — this file and the imported `AGENTS.md` — in context; never compact them.

Extra conventions load automatically by scope: per-directory `CLAUDE.md` files (each a thin `@AGENTS.md` re-export of its sibling, e.g. `apps/desktop/CLAUDE.md`) and path-scoped rules under `.claude/rules/*.md` (e.g. `frontend.md`, which auto-applies to the `apps/webview` / `apps/desktop` renderer). These are Claude Code mechanisms; other tools read the `AGENTS.md` files and the referenced rule directly.
