# Forking LinkCode

How to build and redistribute a fork legally and safely: what you must rename, what you must replace, and which infrastructure belongs to ArcBox and is not yours to publish to.

## Ground rules

- **Code** is source-available under the [Business Source License 1.1](../LICENSE). Production use is allowed within the Additional Use Grant (no competing hosted/embedded offering); each version converts to Apache 2.0 on its Change Date.
- **Brand is not included.** The LinkCode and ArcBox names, logos, icons, and splash imagery are trademarks licensed separately under [`assets/LICENSE`](../assets/LICENSE) and [`assets/BRAND.md`](../assets/BRAND.md). A fork or redistribution **must replace the Brand Assets with its own branding and ship under its own name** — do this *before* you package or distribute anything.

## Rebrand checklist

Work through every row; each one ships ArcBox identity or points at ArcBox infrastructure.

| Touchpoint | Where | Notes |
| --- | --- | --- |
| Product name | `apps/desktop/electron-builder.yml` (`productName`), `apps/desktop/src/main/constants.ts` (`BASE_NAME`: `LinkCode` / `LinkCode Development`) | The app name also keys `userData`, log paths, the safeStorage keychain entry, and the single-instance lock — renaming it isolates your fork from an installed LinkCode. |
| App / bundle ids | `appId: com.arcboxlabs.linkcode.desktop` (`electron-builder.yml`); `com.arcboxlabs.linkcode.mobile` + `"scheme": "linkcode"` (`apps/mobile/app.json`) | Pick ids under your own domain. |
| Deep-link schemes | `linkcode://` in `electron-builder.release.yml`; `linkcode-dev://` in `electron-builder.devshell.yml` (declared per channel on purpose — the shared base carries none) | Cloud-auth callbacks ride this scheme; claim your own. |
| Icons and brand imagery | `assets/icon.png`, `assets/icon-dock.png`, `assets/linkcode.icon` (macOS Liquid Glass bundle, also referenced by the mobile iOS icon), `assets/linux-icons/` (size set regenerated from `icon-dock.png`; see `apps/desktop/scripts/package-app.mts`), plus mobile icon/splash under `apps/mobile` | These are the restricted Brand Assets. The repo ships no unrestricted substitutes — bring your own artwork for every slot. |
| **Updater feed** | `publish.url: https://releases.linkcode.ai/desktop` (`electron-builder.yml`) | **Change or remove this before packaging.** electron-builder bakes it into the app's `app-update.yml`; an unmodified fork polls ArcBox's feed and will happily "update" itself into official LinkCode. |
| State, workspace, and data dirs | `packages/foundation/schema/src/product.ts`: `STATE_DIR_BASENAME` (`~/.linkcode`), `WORKSPACES_DIRNAME` (`~/LinkCode`), `DATA_DIRNAME` (managed-asset store under the platform data dir) | One edit rebrands every on-disk footprint — daemon state, workspace root, asset store — across daemon, desktop, and adapters. They are shared with an installed LinkCode, and the daemon is one-per-machine (port `19523`, `/linkcode` identity probe) — rename them (and ideally the port/identity path) if your fork should coexist with LinkCode on the same machine. |
| Cloud endpoints | `DEFAULT_HQ_URL = https://api.linkcode.ai` (`apps/daemon/src/hq/api.ts`); `CLOUD_API_URL` / sign-in URL (`apps/desktop/src/main/cloud-auth/client.ts`, overridable via `LINKCODE_CLOUD_API_URL` / `LINKCODE_CLOUD_SIGN_IN_URL`); mobile equivalents under `apps/mobile/src/runtime/cloud` | Cloud login is opt-in — a fork is fully functional local-first without it. Point these at your own deployment or leave the feature dormant; do not ship a fork that signs users into ArcBox's Cloud under your brand. |
| Sentry / PostHog | Sentry DSN env vars: `MAIN_VITE_SENTRY_DSN` (desktop, build-time), `LINKCODE_SENTRY_DSN` (daemon), `VITE_SENTRY_DSN` (webview), `EXPO_PUBLIC_SENTRY_DSN` (mobile). PostHog uses a project token + host pair per client; see `docs/ENVIRONMENT.md`. | Unset ⇒ the SDKs no-op. Set your own projects if you want crash reporting or opt-in product analytics. PostHog stays user-opt-in even when configured. |
| Package feeds | Homebrew cask in `arcboxlabs/homebrew-tap`; the R2 release feed | ArcBox's distribution channels. Publish your fork through your own tap/feeds. |

## What already fails safe

- **Signing and publishing are ArcBox-maintainers-only** and live behind the `release` GitHub environment: macOS Developer ID + notarization, Windows Trusted Signing (OIDC), the R2 feed upload, and the Homebrew cask bump all no-op without its secrets — a fork's CI cannot reach them.
- **CI is portable**: every `runs-on` resolves through repo vars with GitHub-hosted fallbacks, so a fork runs the full CI with zero runner setup.
- **Telemetry and Cloud are opt-in**: no Sentry DSN means no crash reporting; PostHog needs both build-time configuration and explicit user consent; no Cloud login means a purely local product.

## Building your fork

Local development is unchanged — see [`DEVELOPMENT.md`](./DEVELOPMENT.md). For packaged builds, the entry point is `apps/desktop/scripts/package-app.mts` (driven by `.github/workflows/build-desktop.yml`; unsigned without the release secrets). Model your release packaging config on `electron-builder.release.yml` with your own name, ids, scheme, icons, and publish target — and re-read [`assets/LICENSE`](../assets/LICENSE) before your first distribution.

Official LinkCode releases (signing, notarization, feeds) follow [`RELEASE.md`](./RELEASE.md) and are performed only by ArcBox maintainers.
