# Environment variables

Every environment variable this repo reads or writes, grouped by the runtime that owns it. The runbook is [`DEVELOPMENT.md`](./DEVELOPMENT.md); release mechanics are [`RELEASE.md`](./RELEASE.md).

There is no `.env` template — `devenv.nix` sets `dotenv.disableHint = true` and nothing here requires an env var to boot. Everything below is an override or a CI-only input.

Two rules that are easy to get wrong:

- **Build-time variables must be declared to turbo.** Only `apps/desktop/turbo.json` and `apps/webview/turbo.json` declare `build.env`; the root `turbo.json` has no `globalEnv`. A new `*_VITE_*` variable that isn't listed there silently reuses a cached bundle built with the old value.
- **`LINKCODE_PORT` means two different things.** For the daemon it overrides the listener port (`apps/daemon/src/config.ts`); for a user script/service it is *written* by the script runner to announce that service's allocated port (`packages/host/engine/src/scripts/script-port-plan.ts`).

## Runtime

Read by the daemon, desktop, webview, or mobile at run time.

| Variable | Read at | Effect |
| --- | --- | --- |
| `LINKCODE_PROFILE` | `apps/daemon/src/config.ts` | Isolated state universe: forks the daemon state dir to `~/.linkcode-<name>`, plus DB, `runtime.json`, and HQ device identity. `[a-z0-9-]`, ≤32 chars; invalid aborts boot. Desktop reads it too, where `--profile=<name>` outranks it, and re-injects the resolved value into the supervised daemon. Unset = the shared `~/.linkcode`. |
| `LINKCODE_PORT` | `apps/daemon/src/config.ts` | Overrides every configured listener's port. Must parse as an integer in `1..65535`, otherwise the config value stands. |
| `LINKCODE_HOST` | `apps/daemon/src/config.ts` | Overrides every listener's bind host. |
| `LINKCODE_PTY_SIDECAR_PATH` | `apps/daemon/src/pty/sidecar.ts` | Absolute path to the `linkcode-pty` binary; always wins. Dev falls back to `target/release/linkcode-pty`; a bundled `dist/` daemon has no fallback and disables terminals. The packaged desktop supervisor sets it to `<resourcesPath>/sidecar/<arch>`. |
| `LINKCODE_SIM_SIDECAR_PATH` | `apps/daemon/src/sim/backend.ts` | Absolute path to the `linkcode-sim` iOS Simulator sidecar; always wins. macOS only — other platforms resolve to none regardless. Dev falls back to `target/release/linkcode-sim`; a bundled `dist/` daemon has no fallback and disables simulators. The packaged desktop supervisor sets it from `<resourcesPath>`. |
| `LINKCODE_AIGATEWAY_PATH` | `apps/daemon/src/ai-gateway.ts` | Path to the `aigateway` translation sidecar, overriding the managed-asset install. |
| `LINKCODE_ASSETS_DIR` | `packages/host/assets/src/paths.ts` | Redirects the managed-asset store root (default: `~/Library/Application Support/LinkCode/assets`, `%LOCALAPPDATA%/LinkCode/assets`, `$XDG_DATA_HOME/linkcode/assets`). Resolved per call, so tests can stub it. |
| `ELECTRON_RENDERER_URL` | `apps/desktop/src/main/window.ts` | Dev-server URL the main process loads instead of the packaged renderer. Written by `apps/desktop/scripts/dev.mts`. |
| `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` (and lowercase forms) | `packages/host/assets/src/system-proxy/index.ts` | If any proxy variable is non-empty, OS proxy autodetection is skipped and the fetch layer's own env handling takes over. `NO_PROXY` is merged back in when an OS-detected proxy is passed explicitly. |
| `SHELL`, `COMSPEC` | `apps/daemon/src/pty/sidecar.ts` | Default PTY shell (`/bin/bash` / `cmd.exe` when unset). macOS starts a login shell on purpose: a Finder-launched app inherits launchd's bare `PATH`. |
| `CODEX_HOME`, `PI_CODING_AGENT_DIR` | `packages/host/agent-adapter/src/native/{codex,pi}/history.ts` | Agent CLI home directories the adapters read history and auth from (`~/.codex`, `~/.pi/agent`). |

### Written into child processes

Not configuration you set — the daemon produces these for the processes it spawns.

| Variable | Written by | Meaning |
| --- | --- | --- |
| `LINKCODE_PORT`, `LINKCODE_URL` | `packages/host/engine/src/scripts/script-port-plan.ts` | A user service's own allocated port and preview-proxy URL. |
| `LINKCODE_SERVICE_<NAME>_PORT`, `LINKCODE_SERVICE_<NAME>_URL` | same | Sibling-service discovery; `<NAME>` is the service name upper-cased with non-word characters replaced by `_`. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CODEX_API_KEY`, `OPENAI_BASE_URL`, `XAI_API_KEY` | `packages/host/agent-adapter/src/credential.ts` | Account credentials handed to the agent subprocess. With token auth, `ANTHROPIC_API_KEY` is explicitly blanked so an inherited key can't defeat the bearer token. |
| account `extraEnv` | `packages/foundation/schema/src/model/account.ts` | A user-defined `Record<string, string>` merged last into every agent subprocess. Open-ended by design — this is the supported escape hatch for agent-specific variables the adapters don't model. |
| `TERM` | `crates/linkcode-pty/src/pty.rs` | Hard-set to `xterm-256color` on every PTY child, then overlaid with the caller's env. The sidecar itself reads no environment. |

## Cloud overrides

Point a client at something other than production LinkCode Cloud. All default to the production endpoints; unset is the normal case.

| Variable | Read at | Default |
| --- | --- | --- |
| `LINKCODE_CLOUD_API_URL` | `apps/desktop/src/main/cloud-auth/client.ts` | `https://api.linkcode.ai` |
| `LINKCODE_CLOUD_SIGN_IN_URL` | `apps/desktop/src/main/cloud-auth/client.ts` | `https://linkcode.ai/sign-in` |
| `VITE_LINKCODE_CLOUD_API_URL` | `apps/webview/src/cloud/auth.ts` | `https://api.linkcode.ai` (build-time inlined) |
| `LINKCODE_HQ_URL` | `apps/daemon/src/hq/login.ts` | `DEFAULT_HQ_URL` in `apps/daemon/src/hq/api.ts` |

`LINKCODE_HQ_URL` falls back on an empty string (`||`); the desktop/webview overrides use `??`, so setting them to `''` yields an empty base URL rather than the default.

## Observability

DSNs are publishable ids, not secrets. Unset means the SDK no-ops — the default for local development.

| Variable | Surface | Notes |
| --- | --- | --- |
| `LINKCODE_SENTRY_DSN` | Daemon process | Read by `apps/daemon/src/instrument.ts`, preloaded via `--import`. The desktop supervisor copies `MAIN_VITE_SENTRY_DSN` into it for the packaged daemon. |
| `MAIN_VITE_SENTRY_DSN` | Electron main | Build-time inlined; declared in `apps/desktop/turbo.json` `build.env`. Only signed builds carry it. |
| `VITE_SENTRY_DSN` | Webview | Build-time inlined; declared in `apps/webview/turbo.json` `build.env`. |
| `EXPO_PUBLIC_SENTRY_DSN` | Mobile | Inlined by Metro/EAS at bundle time. |
| `SENTRY_ALLOW_FAILURE` | EAS `preview` profile | `apps/mobile/eas.json`; keeps a failed sourcemap upload from failing the build. |

## Tests and E2E

| Variable | Used by | Effect |
| --- | --- | --- |
| `LINKCODE_REQUIRE_PTY_SIDECAR` | `apps/daemon/tests/integration/pty-sidecar.test.ts`, `terminal-flood.test.ts` | `1` turns a missing `linkcode-pty` binary from a silent skip into a hard failure. CI sets it; set it locally too when you mean to exercise the real wire protocol. |
| `LINKCODE_PTY_SIDECAR_PATH` | `apps/daemon/e2e/startup.e2e.ts` | Points the spawned daemon at the compiled sidecar (CI uses `target/debug/linkcode-pty`). |
| `LINKCODE_HOST`, `LINKCODE_PORT` | daemon/webview/desktop E2E harnesses | Pin the harness daemon to `127.0.0.1` on an ephemeral port. |
| `LINKCODE_PROFILE` | desktop E2E | Isolates a run's state universe. Must be identical on both sides — the desktop app and its daemon — or they follow different `runtime.json` files. |
| `HOME` | every E2E harness | Redirected to a fresh temp dir so runs never touch the real `~/.linkcode`. Use a *fresh* one per run. |
| `XDG_CONFIG_HOME` | `apps/desktop/e2e/packaged-smoke.e2e.mts` | Redirects Electron/Chromium config for the packaged run. |
| `NODE_ENV` | `apps/webview/e2e/browser-smoke.e2e.mts` | Forced to `development` — the mock transport is guarded by `import.meta.env.DEV`. |
| `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM` | `packages/host/engine/tests/integration/git-status.test.ts` | Point git at fixture config so the machine's gitconfig (notably commit signing) can't leak into assertions. |
| `LINKCODE_PTY_BENCH_BYTES`, `_RUNS`, `_WARMUP_RUNS` | `apps/daemon/src/pty/bench-throughput.mts` | Throughput benchmark payload size (default 8 MiB), measured runs (5), warm-up runs (1). |

## Build

| Variable | Used by | Effect |
| --- | --- | --- |
| `NODE_ENV` | `apps/desktop/scripts/{build,dev}.mts` | Defaulted before Vite runs because it seeds `import.meta.env.MODE`, which decides the desktop channel (`development` vs release) and therefore app name, `userData`, instance lock, and keychain entry. |
| `RENDERER_VITE_*`, `VITE_*` | `apps/desktop/vite.renderer.config.ts` | The only prefixes exposed to desktop renderer code (`envDir` is `apps/desktop`). |
| `CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER` | `apps/desktop/scripts/stage-sidecar.mts` | `aarch64-linux-gnu-gcc` for the linux-arm64 sidecar cross-build. |
| `NODE_OPTIONS` | `.github/workflows/ci.yml` | `--max-old-space-size=4096` for every CI job. |

## Release-only secrets

Set as GitHub repository/environment secrets, never locally. Signing and notarization secrets live in the protected `release` environment; unsigned PR builds get empty values and skip signing. Full context in [`RELEASE.md`](./RELEASE.md).

| Variable | Where | Purpose |
| --- | --- | --- |
| `MACOS_CSC_LINK`, `MACOS_CSC_KEY_PASSWORD` | `build-desktop.yml` | Developer ID certificate and password. Deliberately *not* named `CSC_*`: electron-builder treats a set-but-empty `CSC_LINK` as a certificate path and dies. The run script re-exports them as `CSC_LINK`/`CSC_KEY_PASSWORD` only when non-empty. |
| `CSC_IDENTITY_AUTO_DISCOVERY` | `build-desktop.yml` | `false` on unsigned builds so macOS can't sign with a random keychain identity. |
| `APPLE_API_KEY_BASE64` → `APPLE_API_KEY` | `build-desktop.yml` | The App Store Connect `.p8` is materialized to `$RUNNER_TEMP/apple_api_key.p8`; electron-builder wants a **file path**, not the key content. |
| `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID` | `build-desktop.yml` | notarytool key identity and team. |
| `AZURE_PUBLISHER_NAME`, `AZURE_SIGN_ENDPOINT`, `AZURE_CODE_SIGNING_ACCOUNT`, `AZURE_CERTIFICATE_PROFILE` | `build-desktop.yml` | Windows Trusted Signing identifiers (not credentials, but kept as secrets so the public repo doesn't advertise the signing infrastructure). `AZURE_PUBLISHER_NAME` must match the certificate subject CN exactly. |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` | `build-desktop.yml` | `azure/login` **inputs** for OIDC federation. No `AZURE_*` credential env exists during packaging on purpose, so `DefaultAzureCredential` falls through to the Azure CLI entry. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `release-desktop.yml` | Cloudflare R2 credentials for publishing the electron-updater feed. `AWS_REQUEST_CHECKSUM_CALCULATION`/`AWS_RESPONSE_CHECKSUM_VALIDATION` are pinned to `WHEN_REQUIRED` because R2 doesn't implement the checksums recent aws-cli sends. |
| `BOT_APP_ID`, `BOT_APP_PRIVATE_KEY` | `release-desktop.yml` | GitHub App credentials for the Homebrew cask bump. **Empty makes the bump steps self-skip** — a missing secret is a silent no-op, not a failure. |
