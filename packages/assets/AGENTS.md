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
- **Version pins come from the installed carrier packages** (`version-pin.ts`): claude = its
  agent SDK's version, codex = the `@openai/codex` meta package's version (no JS SDK since the
  app-server rewrite), opencode = its SDK version; tectonic is a catalog constant. "Cannot pin"
  (`undefined`) means hands off: no install, and GC skips that asset entirely rather than risk
  deleting a working install. Closure assets (pi) pin to their committed manifest's version:
  when the SDK also resolves (dev/standalone) a disagreement reads as a stale manifest —
  unpinnable — and when it does not (packaged hosts exclude the closure) the manifest alone is
  the pin, compiled into the daemon alongside the adapter it must match.
- **Store layout** `<root>/<namespace>/<name>/<version>/<binary>` under the platform data dir
  (darwin `~/Library/Application Support/LinkCode/assets`; `LINKCODE_ASSETS_DIR` overrides —
  tests and E2E must set it). An artifact's `extraMembers` land as siblings of the binary under
  their basenames (codex's Windows sandbox helpers, which the CLI resolves strictly next to its
  own binary — CODE-234). All paths resolve at call time so a fake `$HOME` redirects them.
  Installs stage in a `.tmp-*` sibling and publish with one same-volume `rename`; losing the
  rename race to a concurrent install is success (hash-verified identical bytes). A version dir
  that exists but is missing catalog-expected files (an install made before its extra members
  were declared) is backfilled file-by-file — never replaced, the executable may be running;
  `AssetManager.needsRepair` feeds the daemon's boot refresh to trigger exactly that. Boot GC
  removes `.tmp-*` orphans and superseded versions, best-effort, before anything can spawn —
  but a superseded version only once the wanted one is installed: until then it is the consent
  marker that keeps a failed post-upgrade refresh retrying on later boots (CODE-221).
- **codex registry quirk:** `@openai/codex-<platform>` names are npm aliases that 404 — the
  real artifacts are `@openai/codex` versions keyed `<ver>-<platform>-<arch>`, with the binary
  at `package/vendor/<rust-triple>/bin/codex`. All members in `catalog.ts` were read off real
  tarballs; re-verify against a fresh tarball when bumping an SDK.
- **The fetch/verify/extract stack is npm's own, taken at the right layer**: `make-fetch-happen`
  (per-source retry + explicit `HTTPS_PROXY`/`NO_PROXY` env support, with the OS-configured manual
  proxy filling in when the environment names none — `system-proxy/`: win32 reads WinINET via
  `reg.exe`, darwin reads `scutil` via `mac-system-proxy`; both legs adapted from httptoolkit's
  os-proxy-config, vendored because its win32 leg needs the native `registry-js` addon, whose
  win32-only prebuilds would force a node-gyp toolchain on every mac/linux install. PAC
  configurations fail explicitly), `ssri` (integrity streams), `tar` (node-tar, pure JS — tgz
  extraction assumes no system tar), `semver`. This is deliberately
  pacote's engine *without* pacote: its extra layers (sigstore, run-script, git, packlist) are
  npm-CLI semantics that would enter the binary-installing path unused. `env-paths` was
  evaluated and rejected — it hardcodes a `\Data` level on win32 and captures `homedir` at
  module load, breaking call-time path resolution.
- Extraction takes exactly the declared member — no archive content is trusted beyond it. The
  one zip artifact (tectonic win32) shells out to the system bsdtar (System32 since Win10 1809;
  macOS tar is bsdtar too, keeping the branch testable on darwin). Closure packages are the
  exception: whole npm tarballs, extracted with `strip: 1` (node-tar rejects absolute/`..`
  paths, so a hostile archive cannot escape the staging dir).
- **npm-closure assets (CODE-219)**: an asset can be a whole npm tree the daemon imports
  in-process (pi) instead of a binary it spawns. The manifest (`src/pi-closure.gen.ts`) is
  generated from pnpm-lock.yaml — `pnpm -F @linkcode/assets run generate:pi-closure` after a
  pi bump; `closure.test.ts` fails the suite on drift, and a manifest whose version disagrees
  with the SDK pin reads as unpinnable. Layout follows node resolution (highest version
  hoisted, conflicting versions nested under their dependents). The runtime downloads exact
  tgz bytes per package (lockfile SRI baked at build time; npmmirror as URL fallback), stages
  the whole tree, publishes with the same atomic rename — it never resolves versions, never
  runs install scripts, never mutates an installed tree. `managedBinary()` stays binary-only;
  closures answer through `managedEntry()`.

## Consumers

The daemon constructs one `AssetManager` at boot: consent snapshot (`hasInstallOnDisk` — a
prior install of any version is the user's standing consent; GC retains superseded versions
until their replacement lands, so a failed refresh never erases it) → GC → `setManagedResolver`
into `agentRuntimeProber` (managed wins over detected the moment an install lands) → background
`ensure()` only for consented agent pairs the probe found unusable. An agent never installed
here is NOT auto-downloaded (CODE-221) — its first install comes from the client's
`asset.ensure` (the onboarding Download card). The engine serves
`statuses()` on `asset.list`, triggers `ensure()` on `asset.ensure`, and forwards install
lifecycle to the wire via the injected `AssetService`. Tectonic consumers (CODE-81) resolve by
asset id.

Observers use `subscribe()` (progress / installed / failed events), never a per-call
`onProgress`: install.ts's in-flight dedupe keeps only the first caller's callback, so per-call
progress silently vanishes for the second concurrent caller. The flip side: each concurrent
`ensure()` emits its own `installed` event for the shared install — subscribers must revalidate
idempotently. A throwing subscriber is swallowed (an observer must not fail the install).
