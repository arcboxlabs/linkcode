# packages/coss-ui — vendored primitives

COSS UI primitives (base-ui + Tailwind), vendored from cal.com's COSS UI.

- **Never hand-edit this package — it is synced from upstream.** To customize, "fork" the minimal piece into the *consuming* package (a renderer or `packages/ui`) and reuse coss-ui exports as much as possible.
- Tooling exception: this package is formatted **and linted by Biome**, and **excluded from ESLint** — the one place in the repo where that's true.
