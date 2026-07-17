# apps/mobile — Expo / React Native client

Expo + React Native, UI in **HeroUI** (not coss-ui). Reaches the host through the
`server` tunnel; business data still travels over the `transport` + `@linkcode/schema`,
the same contract as every other client.

- **The web renderer conventions do NOT apply here.** [`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) (coss-ui, `createBrowserRouter`, `sdk`+`tayori`+SWR data-table, `react-hook-form`+`zodResolver`) targets the Vite / DOM renderers — none of it holds for React Native. Use the Expo / RN + HeroUI idioms instead.
- **Shared code:** mobile consumes `@linkcode/ui` only through its **native** components (`packages/ui/src/native/**`), never its coss-ui web parts.
- **Terminal canvas:** the RN route owns `LinkCodeClient`, attachment/controller state, and all
  network I/O. Rendering is the native ghostty surface from
  [`expo-libghostty`](https://github.com/arcboxlabs/expo-libghostty) — PTY bytes go in via the
  string API (`writeText` / `onInput.text`, matching the UTF-8 wire), the daemon's headless
  terminal is the sole reply authority, and the grid always tracks the local layout: a resize by
  another controller reflows instead of forcing its cols/rows (read-only fidelity limitation).
  The package's `postinstall` downloads the checksum-pinned native binaries (GhosttyKit.xcframework
  on iOS; per-ABI libghostty-vt static libs on Android, rendered by the package's own Kotlin Canvas
  renderer) — it must stay in root `allowBuilds:`, and adding/upgrading it changes the native
  fingerprint (new dev build).
- **Styling = Uniwind + Tailwind v4, NOT NativeWind.** HeroUI Native 1.0's official companion is `uniwind` (`heroui-native` + `uniwind` + Tailwind v4): metro `withUniwindConfig`, babel is only `babel-preset-expo`, styles are CSS-first in `src/global.css`, and the generated `src/uniwind-types.d.ts` is committed and Biome-ignored. Earlier NativeWind plans are superseded — don't reach for `nativewind`. HeroUI Native still peers on `react-native-gesture-handler` **^2.x** — gesture-handler 3.x is off the table until HeroUI widens that peer.
- **Versions are hard-pinned to the Expo SDK.** React Native must track the SDK's expected version (SDK 57 = RN 0.86.0 / reanimated 4.5.0 / worklets 0.10.0 / gesture-handler ~2.32.0; the SDK's own expectations live in `expo/bundledNativeModules.json` — align with `pnpm -F @linkcode/mobile exec expo install --fix`, then revert its `typescript` edit back to `catalog:`), and `react`/`react-dom` must **exactly** match RN's bundled renderer (RN 0.86.0 → react 19.2.3). The root pnpm catalog leaves these for `apps/mobile` to pin separately. `@sentry/react-native` follows the SDK's expected line (~7.11.0 on SDK 57), not the package's own `latest`.
- **Two RN-resolution traps:** after changing the RN version, run `pnpm dedupe react-native` (a residual nested copy at the old version, pulled by `packages/ui`'s optional peer, breaks uniwind's `className` augmentation); and install `@gorhom/bottom-sheet` even though it is only an optional peer — Metro statically resolves HeroUI's `try/catch` require of it and fails without it.
- **Dev builds, not Expo Go.** Cloud sign-in needs the real `linkcode://` scheme: Expo Go's `exp://…` callback origin is rejected by production HQ (`TRUSTED_ORIGINS` trusts only `https://linkcode.ai,linkcode://`; the `@better-auth/expo` server plugin auto-trusts `exp://` only under `NODE_ENV=development`), so "Sign in" silently 403s there. Build once with `pnpm -F @linkcode/mobile ios` (`expo run:ios`; generates the gitignored `ios/` via prebuild), then daily dev is `pnpm -F @linkcode/mobile start` — with `expo-dev-client` installed it targets the dev build, not Expo Go.
- **Strip the nix toolchain env before `expo run:ios`.** The devenv shell exports `DEVELOPER_DIR`/`SDKROOT` (nix apple-sdk) plus `CC`/`CXX`/`LD`/`NIX_CFLAGS_COMPILE`/`NIX_LDFLAGS`/`MACOSX_DEPLOYMENT_TARGET`, which poison xcodebuild with nix libc++ headers (hundreds of `FP_NORMAL`/`uint8_t` errors), and its PATH puts a nix xcbuild `xcrun` shim before the real one (`xcrun is not configured correctly`). Build with:
  `devenv shell -- sh -c 'export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer PATH="/usr/bin:$PATH" SENTRY_DISABLE_AUTO_UPLOAD=true; unset SDKROOT CC CXX LD NIX_CFLAGS_COMPILE NIX_LDFLAGS MACOSX_DEPLOYMENT_TARGET; pnpm -F @linkcode/mobile ios'`
  (`SENTRY_DISABLE_AUTO_UPLOAD` because the Sentry Xcode phase otherwise fails the build on machines without org/project credentials.)
