# apps/mobile — Expo / React Native client

Expo + React Native. List/form screens render **`@expo/ui`** (real SwiftUI); **HeroUI Native**
covers the RN surfaces that cannot cross over ("What deliberately stays React Native" below).
Reaches the host through the `server` tunnel; business data still travels over `transport` +
`@linkcode/schema`, the same contract as every other client.

**The web renderer conventions do NOT apply here.**
[`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) (coss-ui, `createBrowserRouter`,
`sdk`+`tayori`+SWR, `react-hook-form`) targets the Vite/DOM renderers — none of it holds for React
Native. Mobile consumes `@linkcode/ui` only through its **native** components
(`packages/presentation/ui/src/native/**`), never its coss-ui web parts.

## Code layout & the runtime seam

- `src/runtime/**` + `src/stores/**` own transport, connection, and data-plane wiring; `src/app/**`
  is route shells only; `src/components/**` is presentation grouped by surface (`shell/`, `form/`,
  `account/`, `connect/`, `host/`, `conversation/`, `terminal/`), with private children of one
  parent under that parent (`conversation/prompt-dock/*`).
- **The hooks exported from `runtime/` are the seam** — extend a return value, never reshape one, so
  UI and runtime work can land in parallel. Runtime must not import presentation: a type both sides
  share (e.g. `TerminalRendererRef`) is owned by the hook that drives it.
- **A `runtime/` hook must not hand out a `RefObject`** — `react-hooks/refs` then taints every
  property read of that result at the call site ("Cannot access refs during render"). Expose a
  callback ref instead (`setRenderer` in `use-terminal-session.ts`), and destructure a hook's result
  at the top of the component rather than reading `hook.x` inside JSX — the same rule fires on
  member reads it cannot prove.
- **Terminal:** `runtime/use-terminal-session.ts` owns `LinkCodeClient`, attachment/controller
  state, and all network I/O; the route only renders and navigates. The canvas is the native ghostty
  surface from [`expo-libghostty`](https://github.com/arcboxlabs/expo-libghostty): PTY bytes go
  through the string API (`writeText` / `onInput.text`, matching the UTF-8 wire), the daemon's
  headless terminal is the sole reply authority, and the grid always tracks the local layout — a
  resize by another controller reflows instead of forcing its cols/rows (read-only fidelity
  limitation). The package's `postinstall` downloads checksum-pinned native binaries
  (GhosttyKit.xcframework on iOS; per-ABI libghostty-vt static libs on Android, rendered by the
  package's own Kotlin Canvas renderer) — it must stay in root `allowBuilds:`, and adding/upgrading
  it changes the native fingerprint (new dev build).
- **`src/polyfills.ts` is imported first in the root layout, and the connection depends on it.** RN
  installs `AbortController`/`AbortSignal` from the 2019 `abort-controller` package — no
  `signal.reason`, no `throwIfAborted()` — so `foxts/async-retry`'s opening
  `options.signal?.throwIfAborted()` (the optional chain guards the signal, not the method) threw
  before doing any work and the client never reached the network at all (CODE-462); from the outside
  that read exactly like an unreachable host. When a `foxts`/web API behaves differently here than
  under Node, suspect this class first and probe the runtime rather than reasoning from the API's
  documentation.

## `@expo/ui` (SwiftUI) — its layout rules are not RN's

Settings, terminal appearance, and connect render a real `Form` inside a `Host` (`style={{flex:1}}`
+ `useViewportSizeMeasurement`, or the Form collapses to its content). Each trap below was found
only by driving the simulator:

- **A view's hit area is its content, not its row.** `LabeledContent` sizes a `TextField` to the
  text it holds, so a field with a short placeholder is effectively untappable. Use
  `HStack { Text, TextField }`, and give any hand-built tappable row
  `contentShape(shapes.rectangle())`.
- **A `Button` filling a row swallows horizontal drags**, so a row inside `SwipeActions` opens its
  route instead of revealing its actions. Rows that navigate use `onTapGesture`
  (`components/form/navigation-row.tsx`) — also the closer stand-in for the `NavigationLink` that
  `@expo/ui` does not expose.
- **`TextField` has no `value` prop.** It is either uncontrolled or bound to `useNativeState`;
  prefer the latter and read it with `.get()` at submit time, so submitting never depends on a
  change event having reached JS. Keyboard behaviour comes from modifiers (`keyboardType`,
  `submitLabel`, `onSubmit`, `textInputAutocapitalization`), not props.
- A `Section`'s `isExpanded` is honoured **only** under `listStyle('sidebar')` — that list style is
  what makes the thread groups collapsible, not a cosmetic choice.
- `BottomSheet` needs a `Host` like every other `@expo/ui` view (its source reads like a plain RN
  view, but mounting it directly red-boxes). Give that host `style={{ position: 'absolute' }}` +
  `pointerEvents="box-none"` so it claims no layout, and set `fitToContents` or SwiftUI presents a
  short sheet at a near-full-screen detent.

## What deliberately stays React Native

RN→SwiftUI is the supported direction; going back needs `RNHostView`, whose bidirectional nesting is
the very thing 57.0.5 had to fix. So anything whose indispensable part is an RN view cannot cross
over: **sign-in** (`AppleAuthenticationButton` is an RN view and `@expo/ui` has no Sign in with
Apple), the **conversation surface** — timeline, composer, and the screen holding them (excluded by
the redesign decision; the composer also rides `react-native-keyboard-controller`), the **terminal
canvas** (`expo-libghostty`), the **startup splash** (`BrandMark` is a bundled RN image), and the
**navigation header** (react-navigation). Two smaller losses are accepted rather than worked
around: `Image` takes SF Symbols, asset-catalog names, and local file URIs but **never a remote
URL**, so the account avatar is an SF Symbol; and the agent brand marks are RN SVG components, so
thread rows and the new-thread picker name the agent in text instead.

## Styling & version pins

- **Uniwind + Tailwind v4, NOT NativeWind.** HeroUI Native 1.0's official companion is `uniwind`:
  metro `withUniwindConfig`, babel is only `babel-preset-expo`, styles are CSS-first in
  `src/global.css`, and the generated `src/uniwind-types.d.ts` is committed and Biome-ignored.
  Earlier NativeWind plans are superseded — don't reach for `nativewind`. HeroUI Native still peers
  on `react-native-gesture-handler` **^2.x** — gesture-handler 3.x is off the table until that peer
  widens.
- **Versions are hard-pinned to the Expo SDK**, whose expectations live in
  `expo/bundledNativeModules.json` (SDK 57 = RN 0.86.0 / reanimated 4.5.0 / worklets 0.10.0 /
  gesture-handler ~2.32.0; `react`/`react-dom` 19.2.3). Align with
  `pnpm -F @linkcode/mobile exec expo install --fix`, then revert its `typescript` edit back to
  `catalog:`. **The pin is Expo's, not RN's** — `react-native@0.86.0` peers on `react: ^19.2.3`, a
  caret range the catalog's 19.2.7 also satisfies, so don't argue from "RN requires exactly this".
  Hold the pin because `expo install --fix` rewrites anything else back, and because React's
  renderer internals are compiled against a matching `react` — a drift fails at runtime, subtly.
  The root catalog deliberately keeps its own 19.2.7: one version fork in exchange for keeping the
  web apps' React cadence off the Expo SDK's. The cost is **two react copies in the tree**, which
  `vitest.config.ts` works around (CODE-444, below). `@sentry/react-native` follows the SDK's
  expected line (~7.11.0 on SDK 57), not the package's own `latest`.
- **Two RN-resolution traps:** after changing the RN version, run `pnpm dedupe react-native` (a
  residual nested copy at the old version, pulled by `packages/presentation/ui`'s optional peer,
  breaks uniwind's `className` augmentation); and keep `@gorhom/bottom-sheet` installed even though
  it is only an optional peer — Metro statically resolves HeroUI's `try/catch` require of it and
  fails without it.

## Unit tests (vitest)

- Hooks are unit-testable through this app's own vitest project (`vitest.config.ts`, declared in the
  root config's `projects`). The react pin makes this app's react/react-dom copies nested while
  `@testing-library/react` is hoisted — left alone the two sides load different React instances and
  every hook dies on a null dispatcher (CODE-444) — so the project aliases react/react-dom to the
  **hoisted** pair (safe because the pin exists for Metro's bundle, which vitest never builds).
- Consequence: **only RN-free modules belong here.** A test that reaches a `react-native` or
  `expo-*` import needs a different harness, not a wider alias. `renderHook` needs a DOM, so such
  tests carry `// @vitest-environment jsdom` (`src/runtime/__tests__/use-session-actions.test.ts`).
- Prefer driving a real `LinkCodeClient` over a fake one: a controlled `Transport` lets assertions
  land on wire payloads, which is where silent breakage actually lives (root `AGENTS.md`,
  Invariant 1). `src/runtime/__tests__/client-test-helpers.tsx` supplies that transport plus a
  connected client, so a test never re-answers the handshake by hand.

## UI e2e (maestro)

- **`maestro` comes from devenv** (`devenv.nix`, gated to Darwin — it drives the iOS simulator, so
  Linux CI would pull the JVM closure for nothing). Do **not** `brew install maestro`: Homebrew's
  `maestro` cask is an unrelated AI GUI app (the mobile driver lives in a third-party tap), and a
  per-machine install drifts from the toolchain. Nix's wrapper supplies its own JRE — no JDK to add,
  and none of the `final field mutation` warnings a mismatched JDK produces. Analytics upload is on
  by default — set `MAESTRO_CLI_NO_ANALYTICS=1`.
- Flows live in `e2e/flows/*.yaml`, run with `pnpm -F @linkcode/mobile run e2e:ui` against whatever
  dev build is already installed. Verified against Xcode 26 / iOS 26.5: RN text matches through
  `accessibilityText`, `testID` through `resource-id`. devenv's nix `xcrun` shim (see the build
  recipe below) did not break maestro, but that was with its XCUITest runner already installed — a
  cold run on a fresh simulator is unverified.
- **Keep flows daemon-free where the path allows it** — all three are, `add-host` included: it
  points at a port with nothing listening, and the host screen naming the URL it failed to reach
  *is* the proof the typed text made it into the store. A flow that needs a live host also needs the
  spawn harness from `apps/daemon/e2e/startup.e2e.ts`, which no flow does yet.
- **Every flow starts `stopApp` + `launchApp` + a `retry` group around its deep link.** `launchApp`
  alone reuses a running process, inheriting the previous flow's navigation stack; and a cold start
  redirects to the last active host when the persisted registry hydrates — late enough that an
  immediate `assertVisible` passes in the gap before the screen is replaced. `clearState` is not the
  fix (it wipes the dev client's Metro URL); retrying the link is.
- **Maestro can drive SwiftUI, with two gaps:** `hideKeyboard` does nothing on a Form — submit from
  the return key (`pressKey: Enter`), because tapping a keyboard-covered element silently lands on
  the keyboard instead of failing. And revealing a swipe action needs a screen-percentage drag (an
  element-relative `swipe` is too short), which makes the row's position an assumption — `add-host`
  marks that cleanup `optional`.
- Assert **invariants of the screen**, not its current state: flows that asserted an empty state, a
  collapsed form, or the startup destination all broke on a simulator that had been used before.

## Build & run

- **Dev builds, not Expo Go.** Cloud sign-in needs the real `linkcode://` scheme: production HQ
  trusts only `https://linkcode.ai,linkcode://` (`TRUSTED_ORIGINS`), and the `@better-auth/expo`
  server plugin auto-trusts `exp://` only under `NODE_ENV=development`, so "Sign in" from Expo Go
  silently 403s. Build once with `pnpm -F @linkcode/mobile ios` (`expo run:ios`; generates the
  gitignored `ios/` via prebuild); daily dev is then `pnpm -F @linkcode/mobile start` — with
  `expo-dev-client` installed it targets the dev build, not Expo Go.
- **Strip the nix toolchain env before `expo run:ios`.** The devenv shell exports
  `DEVELOPER_DIR`/`SDKROOT` (nix apple-sdk) plus
  `CC`/`CXX`/`LD`/`NIX_CFLAGS_COMPILE`/`NIX_LDFLAGS`/`MACOSX_DEPLOYMENT_TARGET`, which poison
  xcodebuild with nix libc++ headers (hundreds of `FP_NORMAL`/`uint8_t` errors), and its PATH puts a
  nix xcbuild `xcrun` shim before the real one (`xcrun is not configured correctly`). Build with:

  ```sh
  devenv shell -- sh -c 'export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer PATH="/usr/bin:$PATH" SENTRY_DISABLE_AUTO_UPLOAD=true; unset SDKROOT CC CXX LD NIX_CFLAGS_COMPILE NIX_LDFLAGS MACOSX_DEPLOYMENT_TARGET; pnpm -F @linkcode/mobile ios'
  ```

  (`SENTRY_DISABLE_AUTO_UPLOAD` because the Sentry Xcode phase otherwise fails the build on machines
  without org/project credentials.)
- **Sentry:** `Sentry.init({ dsn: process.env.EXPO_PUBLIC_SENTRY_DSN })` + `Sentry.wrap` on the root
  layout; the Expo plugin uploads source maps for org `arcbox` / project `linkcode-mobile`. Runtime
  reporting no-ops without a DSN. EAS profiles select Expo environments
  (`development`/`preview`/`production`) — set `EXPO_PUBLIC_SENTRY_DSN` there (repo secret
  `SENTRY_DSN_MOBILE` is the source of truth for the value). Local iOS builds keep
  `SENTRY_DISABLE_AUTO_UPLOAD=true` unless `SENTRY_AUTH_TOKEN` is available.
