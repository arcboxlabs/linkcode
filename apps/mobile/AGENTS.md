# apps/mobile — Expo / React Native client

Expo + React Native, UI in **HeroUI** (not coss-ui). Reaches the host through the
`server` tunnel; business data still travels over the `transport` + `@linkcode/schema`,
the same contract as every other client.

- **The web renderer conventions do NOT apply here.** [`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) (coss-ui, `createBrowserRouter`, `sdk`+`tayori`+SWR data-table, `react-hook-form`+`zodResolver`) targets the Vite / DOM renderers — none of it holds for React Native. Use the Expo / RN + HeroUI idioms instead.
- **Shared code:** mobile consumes `@linkcode/ui` only through its **native** components (`packages/ui/src/native/**`), never its coss-ui web parts.
- **Terminal canvas:** the RN route owns `LinkCodeClient`, attachment/controller state, and all
  network I/O. Its app-local Expo DOM component owns only Restty rendering and bridges ordered
  write/resize events plus input callbacks. Keep `unstable_useExpoModulesBridge` and Restty's
  `forwardTerminalReplies` disabled; the daemon's headless terminal is the sole reply authority.
- **Styling = Uniwind + Tailwind v4, NOT NativeWind.** HeroUI Native 1.0's official companion is `uniwind` (`heroui-native` + `uniwind` + Tailwind v4): metro `withUniwindConfig`, babel is only `babel-preset-expo`, styles are CSS-first in `src/global.css`, and the generated `src/uniwind-types.d.ts` is committed and Biome-ignored. Earlier NativeWind plans are superseded — don't reach for `nativewind`. HeroUI Native still peers on `react-native-gesture-handler` **^2.x** — gesture-handler 3.x is off the table until HeroUI widens that peer.
- **Versions are hard-pinned to the Expo SDK.** React Native must track the SDK's expected version (SDK 57 = RN 0.86.0 / reanimated 4.5.0 / worklets 0.10.0 / gesture-handler ~2.32.0; the SDK's own expectations live in `expo/bundledNativeModules.json` — align with `pnpm -F @linkcode/mobile exec expo install --fix`, then revert its `typescript` edit back to `catalog:`), and `react`/`react-dom` must **exactly** match RN's bundled renderer (RN 0.86.0 → react 19.2.3). The root pnpm catalog leaves these for `apps/mobile` to pin separately. `@sentry/react-native` follows the SDK's expected line (~7.11.0 on SDK 57), not the package's own `latest`.
- **Two RN-resolution traps:** after changing the RN version, run `pnpm dedupe react-native` (a residual nested copy at the old version, pulled by `packages/ui`'s optional peer, breaks uniwind's `className` augmentation); and install `@gorhom/bottom-sheet` even though it is only an optional peer — Metro statically resolves HeroUI's `try/catch` require of it and fails without it.
