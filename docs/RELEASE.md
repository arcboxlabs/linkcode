# Desktop Release & Packaging Runbook

How to cut, sign, notarize, and publish the Electron desktop app, plus the packaging trap catalog. Desktop-scoped packaging invariants (asar layout, preload, the `extraResources` runtime contract, `electron-builder.yml` structure) live in [`apps/desktop/AGENTS.md`](../apps/desktop/AGENTS.md); local dev/test/E2E in [`docs/DEVELOPMENT.md`](DEVELOPMENT.md). Desktop has the automated tag-driven delivery pipeline. Mobile has a manually dispatched production build/submit workflow, but is not yet a release-please component; webview and daemon have no publish workflow.

## Release surface

- Seven GitHub Actions workflows, three script modules, and two composite actions own the release path:
  - `.github/workflows/ci.yml` ("CI") — runs on every PR.
  - `.github/workflows/release-please.yml` ("Release Please") — maintains release PRs after pushes to `master`; it never tags or publishes.
  - `.github/workflows/finalize-releases.yml` ("Finalize Releases") — after a successful `master` CI, turns a merged release PR into a draft Release and pushes its validated tag.
  - `.github/workflows/build-desktop.yml` ("Build Desktop") — reusable packaging workflow; **not** PR-triggered.
  - `.github/workflows/release-desktop.yml` ("Release Desktop") — tag-triggered publish.
  - `.github/workflows/build-mobile.yml` ("Build Mobile") — manual Android/iOS production builds on GitHub runners, with optional EAS Submit.
  - `.github/workflows/release-brand-matrix.yml` ("Release Brand Matrix") — strict brand × Desktop/iOS/Android orchestration, isolated artifacts, compliance, provenance, and optional signing/upload.
  - `.github/scripts/release-automation.cjs` — tested Octokit policy for candidate resolution, recovery, and Release preflight checks.
  - `.github/scripts/brand-matrix.cjs` / `release-inputs.cjs` — fail-closed matrix and release-input validation.
  - `.github/actions/build-sidecar` — composite action that builds the PTY sidecar per arch.
  - `.github/actions/render-release-config` — renders only through the exact publisher/source commits pinned by each release manifest.
- All jobs run on **Blacksmith** runners, not stock GitHub: `blacksmith-2vcpu-ubuntu-2404` (CI + the publish job), and the `build-desktop` matrix uses `blacksmith-6vcpu-macos-26` (arm64/M4; Xcode 26 so `actool >= 26` compiles `mac.icon` into `Assets.car`), `blacksmith-4vcpu-windows-2025` (VS Build Tools, enough for NSIS), and `blacksmith-4vcpu-ubuntu-2204` (older glibc for broader AppImage compatibility).

## CI topology & merge gates

- `ci.yml` triggers on push to `master`/`release/*`, `pull_request` (paths-ignore `**.md`), and `workflow_dispatch`. Jobs: **typescript** (`pnpm format:check`, `pnpm lint`, `pnpm typecheck`, build `linkcode-pty`, required-sidecar Vitest, then compiled-daemon process acceptance), **desktop** (unpackaged Electron entry, window-state persistence, plus unsigned packaged devshell), **webview** (production bundle plus Chromium browser smoke), **mobile** (Android and iOS production Expo exports), **rust** (`cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked`), and **All Green** (`needs: [typescript, desktop, webview, mobile, rust]`, `if: always()`, fails unless all five required jobs pass). `NODE_OPTIONS=--max-old-space-size=4096`; installs use `pnpm install --frozen-lockfile`, so a drifted `pnpm-lock.yaml` fails CI at the install step. Markdown-only PRs skip CI (`paths-ignore` applies to the `pull_request` trigger only; pushes to `master`/`release/*` always run). Reproduce CI locally with `--frozen-lockfile` + the 4 GB heap.
- **No status check gates merges** (GitHub-side settings, read via `gh api` in 2026-07 — re-check there; none of this lives in the tree). There is no FOSSA/Snyk/Codecov/Sonar/Renovate/Dependabot config in the tree; the default-branch ruleset gates on code-owner review + review-thread resolution + Copilot review, **not** `required_status_checks`. Code-review apps (greptile, pullfrog) are advisory and block nothing. "All Green" is the aggregate check intended for branch protection if one is ever required — require it rather than the individual jobs (brittle).
- `build-desktop.yml` does **not** validate PRs — its `pull_request:` block is commented out (cost). Desktop packaging runs only via `workflow_call` (from `release-desktop.yml`) or `gh workflow run build-desktop.yml --ref <branch>`. Packaging regressions surface at release/dispatch, never on a PR.

## Cutting a release

- **Never hand-edit a release version or push a release tag.** `release-please-config.json` and `.release-please-manifest.json` bootstrap Desktop at the last published version; conventional `fix` / `feat` / breaking commits update a dedicated release PR, including `apps/desktop/package.json` and `apps/desktop/CHANGELOG.md`. Desktop is a root product component so daemon, sidecar, and shared-package changes count, while pure `apps/mobile` and `apps/webview` commits are excluded. Merge that PR when the accumulated notes and proposed version are ready to ship.
- The release PR merge runs normal `master` CI. Every `master` SHA has its own CI concurrency group so later pushes cannot cancel or replace that exact validation. Only after **All Green** succeeds does `finalize-releases.yml` bind the pending release PR to its tested merge SHA, verify `v${version}` against `apps/desktop/package.json`, and ask release-please to create the lightweight tag plus a draft GitHub Release. Ordinary commits may advance `master` while that CI runs, but the release config, manifest, and automation script must remain byte-identical to the tested merge. `force-tag-creation` makes release-please push the tag even though the Release stays draft. The App token is load-bearing: a tag created with `GITHUB_TOKEN` would not start another workflow.
- `release-desktop.yml` fires on the tag push (or `workflow_dispatch` with `dry_run`, default `true`). Its **build** job calls `build-desktop.yml` with `sign: true` + `secrets: inherit`; its **release** job (`environment: release`) syncs `desktop-*` artifacts to R2, reuses the release-please draft, uploads all assets, and then publishes it. A dispatch with `dry_run: true` builds + signs but publishes nothing.
- **Package-manager bumps** close the release job, on stable `v*.*.*` tags only (no `-` prerelease suffix), each with a short-lived token minted from the org GitHub App (`BOT_APP_ID` / `BOT_APP_PRIVATE_KEY`) — absent secrets make them self-skip. **Homebrew**: token scoped to `arcboxlabs/homebrew-tap`, then that repo's `bump-cask` action for `linkcode` with the two DMG sha256s. **WinGet**: token scoped to the org fork `arcboxlabs/winget-pkgs`, then `vedantmgoyal9/winget-releaser` (`komac update --submit` underneath) opens a version PR on `microsoft/winget-pkgs` for `ArcBox.LinkCode` from the release's `.exe` assets. Both WinGet steps are `continue-on-error` so packaging never fails a release — check the step status in the release job, not the release itself. Two constraints: the package must **already exist** upstream (the action only updates; a from-scratch submission is `komac new`, no manifests are kept in this repo), and an App **installation** token only covers installed repos, so if the upstream PR comes back `resource not accessible by integration` the fallback is a classic PAT with `public_repo` for a bot user that can push to the fork.
- electron-builder derives artifact names and the updater feed from **package.json, not the tag**, so `build-desktop.yml` independently fails unless `v${version}` equals `GITHUB_REF_NAME`. The **GitHub Release** is for human downloads only — the updater reads the R2 feed. Tags containing `-` (e.g. `v1.2.3-beta.1`) publish as prerelease. `release-desktop.yml` concurrency is `cancel-in-progress: false` — never cancel a release mid-flight.

## Mobile production builds

`build-mobile.yml` runs `eas build --local` once per platform: Android on
`${{ vars.CI_RUNNER_LINUX || 'ubuntu-latest' }}` and iOS on
`${{ vars.CI_RUNNER_MACOS || 'macos-26' }}`. Compilation and the resulting `.aab` / `.ipa` stay on
GitHub infrastructure; EAS is still contacted to resolve the project, managed signing credentials,
remote build numbers, the production Update channel, and optional store submission. Each signed
artifact is retained in the workflow run for seven days.

Dispatches default `submit` to `false`. Setting it to `true` uploads the exact artifacts just built
with `eas submit --path --wait` after both platform builds succeed: iOS goes to App Store
Connect/TestFlight, while Android goes to the Google Play internal track. This does not submit an
iOS build to App Review or promote Android beyond internal testing.

The jobs run in GitHub's `release` environment. Before adding mobile secrets, require a reviewer and
restrict deployment branches/tags there; an unprotected environment does not isolate a robot token
from a manually selected ref. Required GitHub inputs are documented in
[`ENVIRONMENT.md`](ENVIRONMENT.md). Build certificates, provisioning profiles, the Android keystore,
the App Store Connect API key, and the Google Play service-account key remain EAS-managed; do not
duplicate them in GitHub. Before enabling `submit`, bootstrap those managed credentials
interactively, confirm the App Store Connect/Play app records, and add the App Store Connect
`ascAppId` to `submit.production.ios` once Apple assigns it. A `submit: true` dispatch fails
preflight before either native build until that ID is present. The iOS main app, share extension,
Live Activity target, and App Group must all have valid profiles.

Production uses EAS remote build versions with `autoIncrement`, serialized by workflow concurrency
so two releases cannot consume versions concurrently. The first build initializes from the local
`ios.buildNumber` / `android.versionCode`; if either store already contains a build, sync its highest
value with `eas build:version:set` before dispatching.

## Adding mobile releases

Desktop deliberately remains the only active package in `release-please-config.json` until the
manual mobile workflow has produced and submitted a validated store build. Activating mobile is then
a separate atomic change: add `apps/mobile` to the manifest at the current `expo.version`, configure
release-please's `expo` strategy with component tags (`mobile-v*.*.*`), and teach
`finalize-releases.yml` to start only the matching Mobile workflow. Keep `v*.*.*` unprefixed tags
reserved for Desktop so existing updater and GitHub download links remain stable.

The Expo strategy updates both `apps/mobile/package.json` and `apps/mobile/app.json`: align their starting versions when activating it. Marketing SemVer belongs in `expo.version`; iOS `buildNumber` and Android `versionCode` are monotonically increasing store build identifiers and should be remote EAS-owned rather than release-please-owned. Native store builds and `expo-updates` production-channel OTA publishes remain separate delivery actions.

## Signing & notarization

Desktop signing and R2 secrets live in the repo's GitHub **`release` Environment** (scoped to that environment, not org-wide). Protect it with required reviewers and deployment branch/tag rules before storing credentials. `build-desktop.yml` sets `environment: ${{ inputs.sign && 'release' || '' }}`, so unsigned PR/dispatch builds see no secrets and skip signing instead of failing; `release-desktop.yml`'s publish job also runs `environment: release` or its R2 creds resolve empty. Mobile production jobs always enter the same environment because every store build is signed; GitHub holds the Expo robot token and build-time telemetry values, while EAS holds the native signing and submit credentials.

- **macOS** — team Developer ID cert (`MACOS_CSC_LINK` / `MACOS_CSC_KEY_PASSWORD`); notarization via `notarytool` with an App Store Connect API key. electron-builder passes `APPLE_API_KEY` as a `.p8` **file path, not content**, so a "Materialize App Store Connect API key (.p8)" step decodes `APPLE_API_KEY_BASE64` to `$RUNNER_TEMP/apple_api_key.p8`. Other env: `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`. `electron-builder.yml` sets `mac.notarize: true`, `hardenedRuntime: true`, `entitlements: build-resources/entitlements.mac.plist`.
- **Windows** — Azure Trusted Signing, with **no client secret and no declaration in `electron-builder.yml`**: injected at package time via `-c.win.azureSignOptions.*` on signed Windows builds only. Auth is OIDC via `azure/login@v2` (federated subject `repo:arcboxlabs/linkcode:environment:release`, `allow-no-subscriptions: true`); the caller needs `permissions: id-token: write`, and there is deliberately **no `AZURE_*` credential env** so `DefaultAzureCredential` falls through to the Azure CLI. Identifiers (`release` secrets): `AZURE_PUBLISHER_NAME` (must equal the cert subject CN), `AZURE_SIGN_ENDPOINT`, `AZURE_CODE_SIGNING_ACCOUNT`, `AZURE_CERTIFICATE_PROFILE`. Debug it as OIDC + `-c` injection, not as a cert file.

## Update feed & artifact naming

- The auto-update feed is an electron-updater **`generic` provider at `https://releases.linkcode.ai/desktop`** (Cloudflare R2 bucket `linkcode-releases`), hardcoded in `electron-builder.yml` `publish:` and baked into every shipped app — **never change it** (changing it strands installed clients). The app carries the URL only in packaging config, never in code (`apps/desktop/src/main/updater.ts` reads it from the baked publish block); auto-update is off in the dev shell. The `/desktop` prefix namespaces the bucket for future artifact families.
- Release builds check at startup and every four hours. electron-updater downloads automatically; once ready, the lower-left sidebar offers an immediate restart or the matching GitHub Changelog. Ignoring the prompt keeps its default install-on-quit behavior.
- `artifactName: ${productName}-${version}-${arch}.${ext}` — the `${arch}` suffix is **load-bearing**: electron-updater picks the feed entry whose filename contains `process.arch` and silently falls back to the *first* entry otherwise, handing some clients the wrong arch. All targets build **per-arch `[x64, arm64]`**, never universal. mac ships `dmg` + `zip` (**the `zip` is required for auto-update** — the updater pulls the zip, not the dmg); win ships `nsis` (`oneClick: false`, `perMachine: false`, `buildUniversalInstaller: false`); linux ships `AppImage` (the only self-updating Linux format) + `deb`, `executableName: linkcode`. rpm/snap deliberately off.
- **R2 publish** (`release-desktop.yml`): `aws s3 sync artifacts/ s3://linkcode-releases/desktop/ --endpoint-url https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` with **no `--delete`** (prior versions stay for delta updates). Mandatory env: `AWS_REGION=auto` (R2 ignores it but the CLI requires one), `AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED` + `AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED` (R2 doesn't implement the CRC32 upload checksums recent aws-cli sends). Creds: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`.

## Immutable config bundle (build-time render)

Signed desktop builds and every mobile store build embed an immutable config bundle (bootstrap endpoints, public keyrings, bundled defaults) rendered at build time by the config publisher — the client never re-implements rendering. The `render-config` job in `build-desktop.yml` (signed builds only) and `build-mobile.yml` (always) calls `.github/actions/render-release-config`, which checks out publisher code from protected `CONFIG_PUBLISHER_REPO` at `publisherGitSha` and structural data from protected `CONFIG_SOURCE_REPO` at the independent `sourceGitSha`. It renders through `pnpm -F @linkcode/<app> config:render` and verifies the manifest's digest bindings (revision bytes, public keyring bytes, target identity, telemetry endpoint, expected snapshot SHA-256). Nothing falls back to a mutable ref, an unvalidated or cross-organization repository, a global install, or stale generated output.

Each checkout uses its own short-lived installation token minted from the organization secrets
`BOT_APP_ID` and `BOT_APP_PRIVATE_KEY`. Trusted workflow steps mint these tokens before checking out
the selected client ref; client-controlled actions receive only repository-scoped read tokens,
never the App private key. Each token requests only Contents read and is explicitly limited to
the selected publisher or source repository. The App must be installed on both private
repositories. Missing secrets or installation access fail before rendering; no long-lived
config-read token is used.

Production rendering reads the root of `CONFIG_SOURCE_REPO` and fails closed while production data
is absent. Workflow code may select only that root or the reviewed `examples/acme-zenith` root used
by the nonproduction pilot; configuration data cannot supply a path.

Inputs live in the GitHub **`release` environment** and a missing value fails the build with an actionable error:

- `CONFIG_PUBLISHER_REPO` (var) — exact canonical `owner/repository` identity for the publisher.
  The current org-wide App contract requires owner `arcboxlabs`; the repository name is not
  hardcoded. Trusted workflow steps validate and split this value before minting a token restricted
  to that one repository.
- `CONFIG_SOURCE_REPO` (var) — exact canonical `owner/repository` identity for structural
  manifest, layers, and assets. It has the same owner restriction and receives a separate token.
  The two repository values must differ. Current values are `arcboxlabs/linkcodehq` and
  `arcboxlabs/linkcode-config`, respectively.
- `CONFIG_RELEASE_REVISION` / `CONFIG_RELEASE_KEYRINGS` (vars) — exact revision-metadata and public-keyrings JSON bytes; the manifest pins their SHA-256s, so drifted content fails closed. Public keys only — private keys never enter this repo or its CI.
- `CONFIG_RELEASE_MANIFEST_DESKTOP` / `CONFIG_RELEASE_MANIFEST_IOS` / `CONFIG_RELEASE_MANIFEST_ANDROID` (vars) — release-render manifest v1 JSON per target (produced by the publisher's release flow), pinning `publisherGitSha`, `sourceGitSha`, brand/platform/channel, telemetry endpoint, input digests, and the expected published snapshot digest.

Enforcement: `LINKCODE_REQUIRE_CONFIG_BUNDLE=1` (set for signed desktop builds) makes the Vite main build fail without `apps/desktop/generated/config-build-bundle.json` and makes `verify-artifacts.mts` require the staged asar copy, which is always byte-compared against the generated render. Mobile gates twice: `pnpm -F @linkcode/mobile config:verify-release` before `eas build`, and the `eas-build-pre-install` hook inside the EAS project archive rejects the committed `{ bundle: null }` sentinel on production profiles (the root `.easignore` — which replaces `.gitignore` for EAS archiving — deliberately lets the generated modules into the archive).

## Brand × platform release matrix

`release-brand-matrix.yml` is manually dispatched against the exact lowercase 40-hex commit that
loaded the workflow (`inputs.ref == github.sha`) and rejects commits not already reachable from
`master`, so protected workflow code, environment ref policy, local actions, and client source have
one trust root. Plan-only requests may supply `matrix_json`; every build instead requires a
`matrix_file` directly under `.github/release/brand-matrices/` in that same reviewed commit. Add or
update the complete matrix through a PR before dispatching a release; Actions variables are not a
release-plan authority. `build`, `sign`, and `upload` are independent, monotonic gates: signing
requires a build, and upload requires signing. The default (`false` for all three) only validates
the selected matrix and needs no credential. `build: true, sign: false` renders one immutable target
set per brand, creates unsigned Desktop packages, and validates production-Hermes exports plus
iOS/Android prebuilds. Nothing is signed or submitted in that path.

The committed `code-561-pilot.json` is deterministic nonproduction evidence only. It pins
publisher `986d9f21403df53bc932f511eb1b5f0bb634d48d`, source
`a1ed4d666721c3aed0d563aaea42fce8b5f945b5`, and the source root
`examples/acme-zenith`. The render action byte-compares that root's generated schema mirror with
the canonical schema in the pinned publisher checkout before parsing. Acme and Zenith, their
`.invalid` endpoints, and this example root are not production brand data.

The JSON root contains `brandBuildMatrixVersion: 1` and a non-empty `brands` array. Every brand has
exactly `brandId`, `channel`, `sourceRoot`, `releaseManifests`, `compliance`, and `distribution`.
`sourceRoot` is either `.` for reviewed production data or `examples/acme-zenith` for the pinned
nonproduction fixture; no other path is accepted.

- `releaseManifests.desktop|ios|android` are complete release-render manifest v1 objects. The three
  targets must share publisher/source commits, config revision, revision digest, and public-keyring
  digest; target brand/platform/channel mismatches are rejected.
- `compliance.desktop|ios|android` has a lexicographically sorted `disclosedFeatures` array and a
  checklist with all five keys set to `true`: `configurableFeaturesDisclosed`,
  `dataPracticesReviewed`, `noExecutableCode`, `permissionsReviewed`, and `storeMetadataReviewed`.
- `distribution.desktop` may be `null` only for plan validation. Every build requires an object containing
  `credentialEnvironment`, `r2Bucket`, `r2Prefix`, and `updateUrl`. `credentialEnvironment` must be
  exactly `release`; no per-brand Environment is part of this contract. Both URL and prefix must end
  in the same brand/channel path. An entry may additionally contain the exact-key
  `legacyDestination` object `{ r2Bucket, r2Prefix, updateUrl }`. Its prefix need not contain the
  brand/channel segments, allowing an immutable pre-matrix updater feed to remain reachable; when
  present, Desktop packaging and upload use that destination instead of the standard one. Uploading
  to a legacy destination additionally requires the workflow ref to be the exact `v<package-version>`
  tag, preventing a manual `master` dispatch from replacing an installed app's feed. The field is
  generic and is accepted only from the reviewed matrix entry—brand IDs do not imply it. Standard and
  legacy R2 bucket/prefix pairs and update URL paths must not overlap within or across brands.
- `distribution.mobile` may be `null` only for plan validation. Every build requires `easProjectId`, its
  exact `https://u.expo.dev/<id>` URL, iOS `appleTeamId`/`ascAppId`, and Android
  `track: "internal"`. EAS project IDs and App Store Connect app IDs must be unique across brands.

After publisher rendering, the gate extracts the actual bundled defaults and requires the
feature/module keys to match `disclosedFeatures` exactly. Review-like keys outside that disclosure
surface, executable-code key segments (`script`, `code`, `wasm`, `plugin`, `command`, and binary
variants), executable URL/file suffixes, and script-like strings fail before any signing starts.
This configuration layer is data-only: it cannot fetch/execute a module or silently enable a
store-review mode. A mobile distribution overlay can set only EAS project/update routing, Apple
team/App Store Connect IDs, and the internal Android track; all other fields are rejected.

Every uploaded build has a canonical `release-provenance.<platform>.json`. Each listed artifact is
bound by its own SHA-256 and size to the exact `brands.manifest.yaml` SHA-256, config revision ID,
canonical bundled-defaults SHA-256, config snapshot SHA-256, source/publisher commits, and release
manifest SHA-256, while the sidecar also records the exact client commit and committed matrix-file
SHA-256. Publish jobs re-hash the artifacts and all immutable inputs before upload. The sidecar is
written with create-only semantics after all checks pass.
Brand render jobs, artifact names, runner workspaces, validation roots, credential pairs, and R2
prefixes are separate. Render jobs preserve successful sibling evidence when another row fails,
while aggregate build and publish-preflight jobs require every brand's five provenance sidecars and
upload inputs before any store submission or R2 upload can begin.

### Required Actions configuration and least privilege

Render vars, signing, upload, store, and observability inputs are read from the single protected
`release` Environment. The reviewed matrix must name that exact Environment for every row. The bot
credentials are organization secrets. Trusted workflow steps report
missing bot credentials before checking out selected client code, and the input scripts report
missing render, signing, or upload values without receiving those bot credentials:

- `release` vars: `CONFIG_PUBLISHER_REPO`, `CONFIG_SOURCE_REPO`, `CONFIG_RELEASE_REVISION`, and
  `CONFIG_RELEASE_KEYRINGS`. Both repository vars must be canonical, different
  `arcboxlabs/repository` identities; malformed, absent, cross-organization, and equal values fail
  before token minting or checkout.
  Revision/keyring values are exact JSON bytes already digest-pinned by each release manifest.
- Config checkouts: organization secrets `BOT_APP_ID` and `BOT_APP_PRIVATE_KEY` mint separate,
  short-lived installation tokens with **Contents: read** only on the validated publisher
  and source repositories. The workflow requests no write or organization permission and never
  passes the App private key to selected code. Each exact commit must be reachable from that
  repository's reviewed `master` branch before its role-specific contract is accepted.
- macOS Desktop: `MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`,
  `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, and `APPLE_TEAM_ID`. The App Store Connect API key needs
  only Developer ID notarization access; it must not have app-management or finance roles.
- Windows Desktop: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_PUBLISHER_NAME`,
  `AZURE_SIGN_ENDPOINT`, `AZURE_CODE_SIGNING_ACCOUNT`, and `AZURE_CERTIFICATE_PROFILE`. The Azure
  app has only the Trusted Signing certificate-profile signer role and an OIDC subject restricted
  to this repository's `release` Environment; no client secret exists.
- Desktop observability in `release`: `SENTRY_DSN_DESKTOP` and
  `POSTHOG_PROJECT_TOKEN` plus the `POSTHOG_HOST` var. These are required publishable identifiers,
  not signing credentials.
- Mobile: `EXPO_TOKEN`, `SENTRY_AUTH_TOKEN`, `SENTRY_DSN_MOBILE`, and
  `POSTHOG_PROJECT_TOKEN`. Issue `EXPO_TOKEN` to a robot account with access only to the matrix's EAS projects;
  scope the Sentry token to source-map upload for the one mobile project. The DSN and PostHog values
  are publishable identifiers but remain protected release inputs.
  Native certificates, provisioning profiles, Android keystores, App Store Connect keys, and Google
  Play service accounts stay EAS-managed and project-scoped. Submissions stop at TestFlight and the
  Play internal track; this workflow never submits to App Review or promotes a Play release.
- Desktop upload: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` in `release`.
  Scope the key pair to the exact `r2Bucket/r2Prefix` destinations in the reviewed matrix with
  object read/write/list only; it must not permit
  bucket/account administration. `R2_ACCOUNT_ID` is exactly the
  lowercase 32-hex Cloudflare account ID; URL-like or otherwise malformed values fail before AWS CLI runs.

Do not store private signing material, access tokens, or service-account JSON in the committed
matrix, repository files, artifacts, or Actions vars. Protect `release` with required reviewers and
only exact `master` plus `v*.*.*` custom deployment policies before enabling `build`, `sign`, or
`upload`. No additional release Environment is required by the brand-matrix workflow.
The environment preflight reads protection metadata with the built-in `GITHUB_TOKEN` and explicit
`actions: read`; this metadata-only token cannot approve or bypass an environment review.

## Packaging inputs (staging & version pins)

- **Per-arch single-importer staging (CODE-107).** electron-builder never packs `apps/desktop` in place; `apps/desktop/scripts/package-app.mts` runs `pnpm --prod deploy --legacy --cpu=<arch>` into one self-contained dir per target architecture **outside** the workspace, then invokes electron-builder once per dir. This is load-bearing twice: selecting one CPU keeps napi-rs optional bindings target-pure, while `appDir === projectDir === workspaceRoot` makes `@electron/rebuild` find better-sqlite3 on Windows and keeps the module collector on one importer. Separate macOS/Windows invocations target the same updater manifest, so the script merges their `files` arrays afterward while retaining x64 as the legacy `path`/`sha512`; Linux already names updater manifests per architecture. CI runs `node scripts/package-app.mts <platform> --publish never …` in place of a bare `electron-builder`.
- **Cross-arch staging.** Each platform build stages *both* arches' sidecar trees before packaging so `extraResources: sidecar/${arch}` resolves: "Build PTY sidecar (both arches)" (`.github/actions/build-sidecar`). **Agent CLI binaries do not ship** (CODE-114): `files` globs in `electron-builder.yml` exclude the SDK platform packages from the asar, and the daemon spawns a detected user install or a managed download from its own asset store (`@linkcode/assets`, CODE-111). The runtime `LINKCODE_PTY_SIDECAR_PATH` contract is desktop-owned — see [`apps/desktop/AGENTS.md`](../apps/desktop/AGENTS.md).
- **Electron version.** `electron-builder.yml` pins `electronVersion: 43.2.0` because electron-builder can't read pnpm's `catalog:` protocol and downloads per-platform Electron by exact version. Keep it in sync with the `electron: ^43.2.0` catalog entry in `pnpm-workspace.yaml`, or a drift silently packages the wrong Electron. On an Electron bump, also refresh `NODE_TARGET` / `CHROME_TARGET` in `apps/desktop/vite.shared.ts` from the new binary (`ELECTRON_RUN_AS_NODE=1 electron -p "process.versions"`).

## Post-pack verification

`node apps/desktop/scripts/verify-artifacts.mts <mac|win|linux>` runs after every packaging (in CI, and locally from `apps/desktop`) and fails on packaging regressions. It asserts: the per-arch artifact set is complete and **every artifact stays under the 200 MB ceiling** (a reintroduced agent binary adds ~66 MB compressed and trips it — CODE-114); every name carries its arch marker; every feed manifest (`latest-mac.yml` / `latest.yml` / `latest-linux.yml` / `latest-linux-arm64.yml`) points at an on-disk file whose `sha512` matches; each unpacked `app.asar` carries the bundled host runtime (`out/daemon/index.mjs` + `out/drizzle/meta/_journal.json`) plus the PTY sidecar (`linkcode-pty[.exe]`) in `Resources`; the smartUnpacked `better-sqlite3` binding is present and its Mach-O/PE/ELF header targets the app's arch (the tripwire for the CODE-107 Windows rebuild miss — a right-arch/wrong-ABI binding is not header-detectable and is covered by the boot E2E instead); and **no agent CLI binaries ship** — no `Resources/agent-bin`, no SDK platform packages in the asar or `app.asar.unpacked`. It normalizes inner asar paths with `inner.replaceAll('/', sep)` because `@electron/asar` splits internal paths by `path.sep`, so a forward-slash path never matches on Windows.

## Traps (symptom → cause → fix)

- **`⨯ … not a file`** from electron-builder on mac → a GitHub Actions `${{ … || '' }}` yields a *set-but-empty* `CSC_LINK`, which electron-builder still treats as a cert path and resolves against `projectDir` → carry the cert under `MACOS_CSC_LINK` and `export CSC_LINK` only inside a run step guarded by `[ -n "$MACOS_CSC_LINK" ]`; force `CSC_IDENTITY_AUTO_DISCOVERY=false` on unsigned mac builds. (This kept PR builds continuously red.)
- **`EMFILE` during packaging (historical)** → electron-builder's node-module-collector used to exhaust file descriptors walking this whole monorepo's `node_modules`, and pnpm's cross-importer dedup could silently drop a uniquely-placed transitive dep out of the asar (js-yaml → boot crash). Both were multi-importer symptoms; the single-importer staging flow above eliminated them, so the macOS `ulimit` bump and the former `patches/app-builder-lib@26.15.3.patch` (with its `patchedDependencies` entry) are gone. The `.pnpmfile.cjs` drizzle-orm↔expo-sqlite peer sever stays — it keeps the expo tree out of the desktop `pnpm deploy` closure.
- **Hunting for a `mac.binaries` option to sign the sidecar** → it doesn't exist in electron-builder v26; `osx-sign` discovers Mach-O binaries in `extraResources` by file header and deep-signs them automatically (the PTY sidecar gets LinkCode's Developer ID + notarization on signed builds). (Team ID observed via `codesign -dv` on artifacts, not stored in the tree: LinkCode `422ACSY6Y5`.)
- **A new `MAIN_VITE_*` value doesn't reach the bundle / turbo serves a stale build** → turbo only threads through env declared in `apps/desktop/turbo.json` `build.env` → add it there. `MAIN_VITE_SENTRY_DSN` is inlined into the main bundle **only on signed builds** (`inputs.sign && secrets.SENTRY_DSN_DESKTOP || ''`; a DSN is a publishable id, not a secret). The packaged daemon supervisor forwards that same value as `LINKCODE_SENTRY_DSN` and preloads `out/daemon/instrument.mjs`.
- **Webview / mobile Sentry DSNs** — repo secrets `SENTRY_DSN_WEBVIEW` / `SENTRY_DSN_MOBILE` map to `VITE_SENTRY_DSN` (webview turbo `build.env`) and `EXPO_PUBLIC_SENTRY_DSN` (Expo inlines `EXPO_PUBLIC_*` at bundle time). `build-mobile.yml` injects the mobile value directly because EAS variables with Secret visibility are unavailable to local builds. Cloud EAS builds may instead read a plain-text or sensitive value from the project environment selected by `eas.json`.
- **Packaged build exits 0 silently, or throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` at launch** (CODE-101; reproducible only when packaged) → the productName/userData lock-theft + workspace-TS-left-external pair — mechanism and fixes in [`apps/desktop/AGENTS.md`](../apps/desktop/AGENTS.md); `verify-artifacts` plus actually launching the packaged app are the guards.
- **A yanked version keeps auto-updating / the R2 bucket grows unbounded** → the R2 sync runs without `--delete`, so prior artifacts persist (delta updates need them) → prune stale objects from `linkcode-releases` by hand; never add `--delete` (it breaks in-flight delta updates).
