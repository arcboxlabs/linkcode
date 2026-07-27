# apps/mobile — Expo / React Native client

Expo + React Native, UI in **HeroUI** (not coss-ui). Reaches the host through the
`server` tunnel; business data still travels over the `transport` + `@linkcode/schema`,
the same contract as every other client.

- **The web renderer conventions do NOT apply here.** [`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) (coss-ui, `createBrowserRouter`, `sdk`+`tayori`+SWR data-table, `react-hook-form`+`zodResolver`) targets the Vite / DOM renderers — none of it holds for React Native. Use the Expo / RN + HeroUI idioms instead.
- **Shared code:** mobile consumes `@linkcode/ui` only through its **native** components (`packages/presentation/ui/src/native/**`), never its coss-ui web parts.
- **Where code goes:** `src/runtime/**` + `src/stores/**` own transport, connection, and data-plane
  wiring; `src/app/**` + `src/components/**` are presentation only. The hooks exported from
  `runtime/` are the seam — extend a return value, never reshape one, so UI and runtime work can
  land in parallel. A `runtime/` hook must **not** hand out a `RefObject`: `react-hooks/refs` then
  taints every property read of that result at the call site ("Cannot access refs during render").
  Expose a callback ref instead — `setRenderer` in `use-terminal-session.ts`. Destructure a hook's
  result at the top of the component rather than reading `hook.x` inside JSX; the same rule fires on
  member reads it cannot prove.
- **Hooks are unit-testable through this app's own vitest project** (`vitest.config.ts`, declared in
  the root config's `projects`). The app pins react/react-dom to RN's bundled version, so its copies
  are nested while `@testing-library/react` is hoisted; left alone the two sides load different React
  instances and every hook dies on a null dispatcher (CODE-444). The project aliases react/react-dom
  to the **hoisted** pair so both agree — safe because the pin exists for Metro's bundle and vitest
  never builds it. Consequence: **only RN-free modules belong here.** A test that reaches a `react-native`
  or `expo-*` import needs a different harness, not a wider alias. `renderHook` needs a DOM, so such
  tests carry `// @vitest-environment jsdom` (`src/runtime/__tests__/use-session-actions.test.tsx`).
  Prefer driving a real `LinkCodeClient` over a fake one: a controlled `Transport` lets the assertions
  land on wire payloads, which is where silent breakage actually lives (root `AGENTS.md`, Invariant 1).
- **Terminal canvas:** `runtime/use-terminal-session.ts` owns `LinkCodeClient`, attachment/controller
  state, and all network I/O; the route only renders and navigates. Rendering is the native ghostty
  surface from
  [`expo-libghostty`](https://github.com/arcboxlabs/expo-libghostty) — PTY bytes go in via the
  string API (`writeText` / `onInput.text`, matching the UTF-8 wire), the daemon's headless
  terminal is the sole reply authority, and the grid always tracks the local layout: a resize by
  another controller reflows instead of forcing its cols/rows (read-only fidelity limitation).
  The package's `postinstall` downloads the checksum-pinned native binaries (GhosttyKit.xcframework
  on iOS; per-ABI libghostty-vt static libs on Android, rendered by the package's own Kotlin Canvas
  renderer) — it must stay in root `allowBuilds:`, and adding/upgrading it changes the native
  fingerprint (new dev build).
- **Styling = Uniwind + Tailwind v4, NOT NativeWind.** HeroUI Native 1.0's official companion is `uniwind` (`heroui-native` + `uniwind` + Tailwind v4): metro `withUniwindConfig`, babel is only `babel-preset-expo`, styles are CSS-first in `src/global.css`, and the generated `src/uniwind-types.d.ts` is committed and Biome-ignored. Earlier NativeWind plans are superseded — don't reach for `nativewind`. HeroUI Native still peers on `react-native-gesture-handler` **^2.x** — gesture-handler 3.x is off the table until HeroUI widens that peer.
- **Versions are hard-pinned to the Expo SDK.** React Native must track the SDK's expected version (SDK 57 = RN 0.86.0 / reanimated 4.5.0 / worklets 0.10.0 / gesture-handler ~2.32.0; the SDK's own expectations live in `expo/bundledNativeModules.json` — align with `pnpm -F @linkcode/mobile exec expo install --fix`, then revert its `typescript` edit back to `catalog:`), and `react`/`react-dom` follow `bundledNativeModules.json` too (SDK 57 → 19.2.3). **That pin is Expo's, not RN's** — `react-native@0.86.0` peers on `react: ^19.2.3`, a caret range the catalog's 19.2.7 also satisfies, so don't argue from "RN requires exactly this". Hold the pin because `expo install --fix` rewrites anything else back, and because React's renderer internals are compiled against a matching `react` — a drift fails at runtime, subtly, not at build. The root pnpm catalog deliberately keeps its own 19.2.7 rather than unifying down: that trades one version fork for keeping the web apps' React cadence off the Expo SDK's. The cost of that trade is **two react copies in the tree**, which is what `vitest.config.ts` here works around (CODE-444). `@sentry/react-native` follows the SDK's expected line (~7.11.0 on SDK 57), not the package's own `latest`.
- **Two RN-resolution traps:** after changing the RN version, run `pnpm dedupe react-native` (a residual nested copy at the old version, pulled by `packages/presentation/ui`'s optional peer, breaks uniwind's `className` augmentation); and install `@gorhom/bottom-sheet` even though it is only an optional peer — Metro statically resolves HeroUI's `try/catch` require of it and fails without it.
- **UI e2e driver is `maestro`, and it comes from devenv** (`devenv.nix`, gated to Darwin — it drives
  the iOS simulator, so Linux CI would pull the JVM closure for nothing). Do **not** `brew install
  maestro`: Homebrew's `maestro` cask is an unrelated AI GUI app, the mobile driver lives in a
  third-party tap, and a per-machine install drifts from the toolchain. Nix's wrapper supplies its own
  JRE — no JDK to add, and none of the `final field mutation` warnings a mismatched JDK produces.
  Analytics upload is **on by default**: set `MAESTRO_CLI_NO_ANALYTICS=1`. Verified against Xcode 26 /
  iOS 26.5: it reads RN text through `accessibilityText` and `testID` through `resource-id`, so flows
  can match on either. devenv's PATH shadows `xcrun` with a nix xcbuild shim (see below) and Maestro
  still worked, but that was with its XCUITest runner already installed on the device — a cold run on
  a fresh simulator is unverified.
- **Dev builds, not Expo Go.** Cloud sign-in needs the real `linkcode://` scheme: Expo Go's `exp://…` callback origin is rejected by production HQ (`TRUSTED_ORIGINS` trusts only `https://linkcode.ai,linkcode://`; the `@better-auth/expo` server plugin auto-trusts `exp://` only under `NODE_ENV=development`), so "Sign in" silently 403s there. Build once with `pnpm -F @linkcode/mobile ios` (`expo run:ios`; generates the gitignored `ios/` via prebuild), then daily dev is `pnpm -F @linkcode/mobile start` — with `expo-dev-client` installed it targets the dev build, not Expo Go.
- **Strip the nix toolchain env before `expo run:ios`.** The devenv shell exports `DEVELOPER_DIR`/`SDKROOT` (nix apple-sdk) plus `CC`/`CXX`/`LD`/`NIX_CFLAGS_COMPILE`/`NIX_LDFLAGS`/`MACOSX_DEPLOYMENT_TARGET`, which poison xcodebuild with nix libc++ headers (hundreds of `FP_NORMAL`/`uint8_t` errors), and its PATH puts a nix xcbuild `xcrun` shim before the real one (`xcrun is not configured correctly`). Build with:
  `devenv shell -- sh -c 'export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer PATH="/usr/bin:$PATH" SENTRY_DISABLE_AUTO_UPLOAD=true; unset SDKROOT CC CXX LD NIX_CFLAGS_COMPILE NIX_LDFLAGS MACOSX_DEPLOYMENT_TARGET; pnpm -F @linkcode/mobile ios'`
  (`SENTRY_DISABLE_AUTO_UPLOAD` because the Sentry Xcode phase otherwise fails the build on machines without org/project credentials.)
- **Sentry:** `Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN })` + `Sentry.wrap` on the root layout; the Expo plugin is configured for org `arcbox` / project `linkcode-mobile` (source-map upload). Runtime reporting no-ops without a DSN. EAS profiles select Expo environments (`development` / `preview` / `production`) — set `EXPO_PUBLIC_SENTRY_DSN` there (repo secret `SENTRY_DSN_MOBILE` is the source of truth for the value). Local iOS builds keep `SENTRY_DISABLE_AUTO_UPLOAD=true` unless `SENTRY_AUTH_TOKEN` is available.
