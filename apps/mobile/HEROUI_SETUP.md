# Mobile 样式：NativeWind（已接入）+ HeroUI（待叠加）

## NativeWind —— 已接入 ✅

mobile 用 **NativeWind**（React Native 版 Tailwind）。已配置并通过 `expo export` 验证打包链路（babel → metro → tailwind）：

- `package.json`：`nativewind@5 preview` + `tailwindcss@4`；`react-native-css`；`react-native-reanimated` + `react-native-worklets`。
- `babel.config.js`：`babel-preset-expo`（`jsxImportSource: 'nativewind'`）+ `nativewind/babel`，并以 `react-native-worklets/plugin` 收尾（reanimated 4）。
- `metro.config.js`：monorepo 配置外套 `withNativeWind(config, { input: './src/global.css' })`。
- `src/global.css`：Tailwind 4 `theme + utilities`（`source(none)` 只扫描 mobile 源码）+ `nativewind/theme` + CoSSUI 调色板（与 web/desktop 同名：`bg-bg` / `text-muted` / `text-accent` …）。
- `postcss.config.js`：使用 `@tailwindcss/postcss`，让 Expo/Metro 先展开 Tailwind 4 CSS，再交给 `react-native-css`。
- `tailwind.config.js`：保留为轻量 editor/tooling fallback；`src/nativewind-env.d.ts`：类型引用 + `*.css` 声明。
- 源码统一放在 `src/`（与 web/desktop 一致）：`src/App.tsx` 为根组件，根目录 `index.ts` 仅 `registerRootComponent(App)`。

> 注意：本仓 pnpm 设置 `nodeLinker: hoisted`（在 `pnpm-workspace.yaml`），Metro 才能解析 NativeWind 的传递依赖。

用法：在组件上直接写 `className`，例：`<View className="flex-1 bg-bg"><Text className="text-text">…</Text></View>`。

## HeroUI —— 在 NativeWind 之上叠加（待落地）

PLAN ✅ 指定 Mobile UI 为 HeroUI（`heroui-native`）。它构建在 NativeWind 之上，已就绪的部分无需重做，只需补：

1. 安装额外 peer（用 expo 选 SDK 兼容版本）：
   ```bash
   pnpm --filter @linkcode/mobile exec expo install \
     heroui-native @gorhom/bottom-sheet react-native-gesture-handler \
     react-native-safe-area-context react-native-screens react-native-svg \
     tailwind-merge tailwind-variants
   ```
2. `src/global.css` 末尾追加：`@import 'heroui-native/styles';`，并在 `tailwind.config.js` 的 `content` 加入 `./node_modules/heroui-native/**/*.{js,jsx,ts,tsx}`。
3. `src/App.tsx` 外层包裹（顺序：手势 → 安全区 → HeroUI）：
   ```tsx
   import 'react-native-gesture-handler';
   import { GestureHandlerRootView } from 'react-native-gesture-handler';
   import { SafeAreaProvider } from 'react-native-safe-area-context';
   import { HeroUINativeProvider } from 'heroui-native';
   // <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><HeroUINativeProvider> … </HeroUINativeProvider></SafeAreaProvider></GestureHandlerRootView>
   ```
   > Provider / 组件确切导出名以安装后的 `heroui-native` 类型定义为准。
4. 验证：`pnpm --filter @linkcode/mobile exec expo export -p android`（打包）；UI 表现需在模拟器 / 真机上确认。
