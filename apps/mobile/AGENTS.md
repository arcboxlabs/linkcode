# apps/mobile — Expo / React Native client

Expo + React Native, UI in **HeroUI** (not coss-ui). Reaches the host through the
`server` tunnel; business data still travels over the `transport` + `@linkcode/schema`,
the same contract as every other client.

- **The web renderer conventions do NOT apply here.** [`.claude/rules/frontend.md`](../../.claude/rules/frontend.md) (coss-ui, `createBrowserRouter`, `sdk`+`tayori`+SWR data-table, `react-hook-form`+`zodResolver`) targets the Vite / DOM renderers — none of it holds for React Native. Use the Expo / RN + HeroUI idioms instead.
- **Shared code:** mobile consumes `@linkcode/ui` only through its **native** components (`packages/ui/src/native/**`), never its coss-ui web parts.
- **Styling = Uniwind + Tailwind v4, NOT NativeWind.** HeroUI Native 1.0's official companion is `uniwind` (`heroui-native@1.0.4` + `uniwind` + Tailwind v4): metro `withUniwindConfig`, babel is only `babel-preset-expo`, styles are CSS-first in `src/global.css`, and the generated `src/uniwind-types.d.ts` is committed and Biome-ignored. Earlier NativeWind plans are superseded — don't reach for `nativewind`.
- **Versions are hard-pinned to the Expo SDK.** React Native must track the SDK's expected version (SDK 56 = RN 0.85.3 / reanimated 4.3.1 / worklets 0.8.3; at pin time RN 0.86 broke against `react-native-gesture-handler` 2.31's reference to the deleted `Libraries/Renderer/shims/ReactNative` — re-verify on any upgrade), and `react`/`react-dom` must **exactly** match RN's bundled renderer (RN 0.85.3 → react 19.2.3). The root pnpm catalog leaves these for `apps/mobile` to pin separately.
- **`pnpm-workspace.yaml` `peerDependencyRules.allowedVersions` pins `react-native-worklets: 0.9.2`** — Expo SDK 56's `expo-modules-core` hasn't widened that peer for the reanimated 4.4 bump. The app itself still pins worklets 0.8.3 / reanimated 4.3.1; a reanimated/worklets upgrade must reconcile this anticipatory rule.
- **Two RN-resolution traps:** after downgrading RN, run `pnpm dedupe react-native` (a residual nested `react-native@0.86` pulled by `packages/ui`'s optional peer breaks uniwind's `className` augmentation); and install `@gorhom/bottom-sheet` even though it is only an optional peer — Metro statically resolves HeroUI's `try/catch` require of it and fails without it.
