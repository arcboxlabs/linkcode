# packages/vendor/coss-ui — vendored primitives

COSS UI primitives (base-ui + Tailwind), vendored from cal.com's COSS UI.

- **Never hand-edit this package — it is synced from upstream.** To customize, "fork" the minimal piece into the *consuming* package (a renderer or `packages/presentation/ui`) and reuse coss-ui exports as much as possible.
- Tooling exception: this package is **excluded from ESLint and from the root Biome config** (`!packages/vendor/coss-ui` in `biome.json`), so upstream formatting is preserved as-synced — never reformat it.
