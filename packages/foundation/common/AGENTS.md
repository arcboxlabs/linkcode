# packages/foundation/common — shared utilities

Small, product-agnostic utilities that do not belong to the data contract, transport,
client data layer, UI, or host runtime.

- Keep this package boring and narrow. Add helpers here only when at least two packages
  can plausibly share them, or when the helper is a reusable integration boundary such
  as a storage/middleware adapter.
- Do not put business data contracts here. Cross-process and cross-endpoint message
  schemas belong in `@linkcode/schema`.
- Do not put client data fetching, connection state, or tayori/SWR helpers here; those
  belong in `client-core`, `sdk`, or `workbench`.
- Do not put React components, coss-ui styling, or product UI here; those belong in
  `ui`, `coss-ui`, an app, or `workbench`.
- Keep exports explicit and scoped by concern (for example `@linkcode/common/zustand`),
  rather than growing a broad catch-all barrel.
