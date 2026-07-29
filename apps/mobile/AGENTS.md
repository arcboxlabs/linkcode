# apps/mobile — Expo / React Native client

Expo + React Native. Screens that are lists or forms render **`@expo/ui`** (real SwiftUI);
**HeroUI** remains for the React Native surfaces that cannot cross over — see the two bullets on
`@expo/ui` below for which those are and why. Reaches the host through the `server` tunnel;
business data still travels over the `transport` + `@linkcode/schema`, the same contract as every
other client.

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
  tests carry `// @vitest-environment jsdom` (`src/runtime/__tests__/use-session-actions.test.ts`).
  Prefer driving a real `LinkCodeClient` over a fake one: a controlled `Transport` lets the assertions
  land on wire payloads, which is where silent breakage actually lives (root `AGENTS.md`, Invariant 1).
  `__tests__/client-test-helpers.tsx` supplies that transport plus a connected client, so a test
  never re-answers the handshake by hand.
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
- **Native screens are `@expo/ui` SwiftUI, and its layout rules are not RN's.** Settings, terminal
  appearance, and connect render a real `Form` inside a `Host` (`style={{flex:1}}` +
  `useViewportSizeMeasurement`, or the Form collapses to its content). Three traps, each found only
  by driving the simulator:
  - **A view's hit area is its content, not its row.** `LabeledContent` sizes a `TextField` to the
    text it holds, so taps in the rest of the row are lost — a field with a short placeholder is
    effectively untappable while one with a long placeholder works. Use `HStack { Text, TextField }`,
    and give any hand-built tappable row `contentShape(shapes.rectangle())`.
  - **A `Button` filling a row swallows horizontal drags**, so a row inside `SwipeActions` opens its
    route instead of revealing its actions. Rows that navigate use `onTapGesture` instead
    (`components/form-row.tsx`) — which is also the closer stand-in for the `NavigationLink`
    `@expo/ui` does not expose.
  - **`TextField` has no `value` prop.** It is either uncontrolled or bound to `useNativeState`;
    prefer the latter and read it with `.get()` at submit time, so submitting never depends on a
    change event having reached JS. Keyboard behaviour comes from modifiers, not props
    (`keyboardType`, `submitLabel`, `onSubmit`, `textInputAutocapitalization`).
  - Two more shapes worth knowing: a `Section`'s `isExpanded` is honoured **only** under
    `listStyle('sidebar')` — that list style is what makes the thread groups collapsible, not a
    cosmetic choice; and `BottomSheet` needs a `Host` like every other `@expo/ui` view (its source
    reads like a plain RN view, but mounting it directly red-boxes). Give that host
    `style={{ position: 'absolute' }}` + `pointerEvents="box-none"` so it claims no layout, and set
    `fitToContents` or SwiftUI presents a short sheet at a near-full-screen detent.
- **What deliberately stays React Native, and why.** `@expo/ui` renders SwiftUI, so anything whose
  indispensable part is an RN view cannot cross over — RN→SwiftUI is the supported direction, and
  going back needs `RNHostView`, whose bidirectional nesting is the very thing 57.0.5 had to fix.
  So: **sign-in** (`AppleAuthenticationButton` is an RN view and `@expo/ui` has no Sign in with
  Apple), the **conversation surface** — timeline, composer, and the screen holding them (excluded
  by the redesign decision; the composer also rides `react-native-keyboard-controller`), the
  **terminal canvas** (`expo-libghostty`), the **startup splash** (`BrandMark` is a bundled RN
  image), and the **navigation header** (react-navigation). Two smaller losses are accepted rather
  than worked around: `Image` takes SF Symbols, asset-catalog names, and local file URIs but
  **never a remote URL**, so the account avatar is an SF Symbol; and the agent brand marks are RN
  SVG components, so thread rows and the new-thread picker name the agent in text instead.
- **`src/polyfills.ts` is imported first in the root layout, and the connection depends on it.**
  React Native installs `AbortController`/`AbortSignal` from the 2019 `abort-controller` package, which
  has neither `signal.reason` nor `signal.throwIfAborted()`. `foxts/async-retry` opens with
  `options.signal?.throwIfAborted()` — the optional chain guards the signal, not the method — so
  every retry given a signal threw `TypeError: undefined is not a function` before doing any work,
  and the mobile client never reached the network at all (CODE-462). Nothing about that reads as a
  platform gap from the outside: it looks exactly like an unreachable host. When a `foxts`/web API
  behaves differently here than under Node, suspect this class first, and probe the runtime rather
  than reasoning from the API's documentation.
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
  a fresh simulator is unverified. Flows live in `e2e/*.yaml`, run with
  `pnpm -F @linkcode/mobile run e2e:ui` against whatever dev build is already installed. Keep them
  daemon-free where the path allows it — all three are, `add-host` included: it points at a port with
  nothing listening, and the host screen naming the URL it failed to reach *is* the proof the typed
  text made it into the store. A flow that needs a live host also needs the spawn harness from
  `apps/daemon/e2e/startup.e2e.ts`, which no flow does yet.
  - **Every flow starts `stopApp` + `launchApp` + a `retry` group around its deep link.** `launchApp`
    alone reuses a running process, so a flow inherits the previous one's navigation stack; and a
    cold start redirects to the last active host when the persisted registry *hydrates*, which can
    land after the deep link and replace the screen it opened — late enough that an immediate
    `assertVisible` passes in the gap. `clearState` is not the fix: it wipes the dev client's Metro
    URL. Retrying the link is.
  - **Maestro can drive SwiftUI, with two gaps.** `hideKeyboard` does nothing on a Form, so submit
    from the return key (`pressKey: Enter`) rather than a button the keyboard covers — and tapping a
    covered element silently lands on the keyboard instead of failing. Revealing a swipe action needs
    a longer drag than an element-relative `swipe` produces; only a screen-percentage drag works,
    which makes the row's position an assumption, so `add-host` marks that cleanup `optional`.
  - Assert **invariants of the screen**, not its current state. Flows that asserted an empty state, a
    collapsed form, or the startup destination all broke on a simulator that had been used before.
- **Dev builds, not Expo Go.** Cloud sign-in needs the real `linkcode://` scheme: Expo Go's `exp://…` callback origin is rejected by production HQ (`TRUSTED_ORIGINS` trusts only `https://linkcode.ai,linkcode://`; the `@better-auth/expo` server plugin auto-trusts `exp://` only under `NODE_ENV=development`), so "Sign in" silently 403s there. Build once with `pnpm -F @linkcode/mobile ios` (`expo run:ios`; generates the gitignored `ios/` via prebuild), then daily dev is `pnpm -F @linkcode/mobile start` — with `expo-dev-client` installed it targets the dev build, not Expo Go.
- **Strip the nix toolchain env before `expo run:ios`.** The devenv shell exports `DEVELOPER_DIR`/`SDKROOT` (nix apple-sdk) plus `CC`/`CXX`/`LD`/`NIX_CFLAGS_COMPILE`/`NIX_LDFLAGS`/`MACOSX_DEPLOYMENT_TARGET`, which poison xcodebuild with nix libc++ headers (hundreds of `FP_NORMAL`/`uint8_t` errors), and its PATH puts a nix xcbuild `xcrun` shim before the real one (`xcrun is not configured correctly`). Build with:
  `devenv shell -- sh -c 'export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer PATH="/usr/bin:$PATH" SENTRY_DISABLE_AUTO_UPLOAD=true; unset SDKROOT CC CXX LD NIX_CFLAGS_COMPILE NIX_LDFLAGS MACOSX_DEPLOYMENT_TARGET; pnpm -F @linkcode/mobile ios'`
  (`SENTRY_DISABLE_AUTO_UPLOAD` because the Sentry Xcode phase otherwise fails the build on machines without org/project credentials.)
- **Sentry:** `Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN })` + `Sentry.wrap` on the root layout; the Expo plugin is configured for org `arcbox` / project `linkcode-mobile` (source-map upload). Runtime reporting no-ops without a DSN. EAS profiles select Expo environments (`development` / `preview` / `production`) — set `EXPO_PUBLIC_SENTRY_DSN` there (repo secret `SENTRY_DSN_MOBILE` is the source of truth for the value). Local iOS builds keep `SENTRY_DISABLE_AUTO_UPLOAD=true` unless `SENTRY_AUTH_TOKEN` is available.
