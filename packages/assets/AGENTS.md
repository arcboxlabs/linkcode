# packages/assets — the daemon's managed-asset store

`@linkcode/assets` (CODE-111) downloads, verifies, atomically installs, and garbage-collects
the platform binaries LinkCode provisions for the user: the agent CLI pairs (claude-code /
codex / opencode) and standalone toolchains (tectonic). Daemon-only — clients see assets via
the `asset.list` wire resource; presentation belongs to the onboarding UI (CODE-112).

## Invariants

- **Trust lives in the pinned hash, not the source.** Every artifact resolves to an SRI digest
  (npm `dist.integrity` fetched per-version at runtime; GitHub sources hand-verified and baked
  into `catalog.ts`), and `urls` is an ordered multi-source list — sources are interchangeable,
  so a mirror or fallback never changes the trust model. The compat manifest (CODE-77) will
  replace baked/registry trust with a signed document; keep `ManagedAssetArtifact` (in
  `@linkcode/schema`) forward-compatible with it.
- **claude platform packages are proprietary** (© Anthropic PBC, all rights reserved): their
  URLs must always point at the npm registry — never mirror them to our own hosting. codex is
  Apache-2.0, opencode/tectonic MIT — mirrorable.
- **Version pins come from the installed SDKs** (`version-pin.ts`): claude = SDK version,
  codex = codex-sdk's exact `@openai/codex` dependency, opencode = its SDK version; tectonic is
  a catalog constant. "Cannot pin" (`undefined`) means hands off: no install, and GC skips that
  asset entirely rather than risk deleting a working install.
- **Store layout** `<root>/<namespace>/<name>/<version>/<binary>` under the platform data dir
  (darwin `~/Library/Application Support/LinkCode/assets`; `LINKCODE_ASSETS_DIR` overrides —
  tests and E2E must set it). All paths resolve at call time so a fake `$HOME` redirects them.
  Installs stage in a `.tmp-*` sibling and publish with one same-volume `rename`; losing the
  rename race to a concurrent install is success (hash-verified identical bytes). Boot GC
  removes superseded versions and `.tmp-*` orphans, best-effort, before anything can spawn.
- **codex registry quirk:** `@openai/codex-<platform>` names are npm aliases that 404 — the
  real artifacts are `@openai/codex` versions keyed `<ver>-<platform>-<arch>`, with the binary
  at `package/vendor/<rust-triple>/bin/codex`. All members in `catalog.ts` were read off real
  tarballs; re-verify against a fresh tarball when bumping an SDK.
- Extraction shells out to the system `tar` (bsdtar on macOS/Windows reads zip too; linux
  artifacts stay `.tar.gz` for GNU tar) and extracts exactly the declared member — no archive
  content is trusted beyond it.

## Consumers

The daemon constructs one `AssetManager` at boot: GC → `setManagedResolver` into
`agentRuntimeProber` (managed wins over detected the moment an install lands) → background
`ensure()` for agent pairs the probe found unusable. The engine serves `statuses()` on
`asset.list` via the injected `AssetService`. Tectonic consumers (CODE-81) resolve by asset id.
