# HeroUI Native 接入（待落地）

PLAN ✅ 指定 Mobile UI 为 HeroUI。其 React Native 版本为 [`heroui-native`](https://www.npmjs.com/package/heroui-native)（当前 `1.0.4`），依赖 NativeWind + Tailwind + Reanimated 一整套原生链路。这些原生配置必须在**模拟器 / 真机**上验证，当前环境无法启动模拟器，故此处保留为下一步。基线 App 暂用 React Native 原生组件，并已打通共享 `@linkcode/schema`。

## 1. 安装（用 expo install 选取 SDK 56 兼容版本）

```bash
pnpm --filter @linkcode/mobile exec expo install \
  heroui-native nativewind tailwindcss \
  react-native-reanimated react-native-worklets \
  react-native-gesture-handler react-native-safe-area-context \
  react-native-screens react-native-svg \
  @gorhom/bottom-sheet tailwind-merge tailwind-variants
```

`heroui-native@1.0.4` 的 peerDependencies：`@gorhom/bottom-sheet ^5.2.9`、`react-native-gesture-handler ^2.28.0`、`react-native-reanimated ^4.1.1`、`react-native-safe-area-context ^5.6.0`、`react-native-screens >=4`、`react-native-svg ^15.12.1`、`react-native-worklets >=0.5.1`、`tailwind-merge ^3.4.0`、`tailwind-variants ^3.2.2`。

## 2. NativeWind / Tailwind 配置

`babel.config.js`：

```js
module.exports = (api) => {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    // Reanimated 4 用 worklets 插件，必须放在 plugins 最后一项。
    plugins: ['react-native-worklets/plugin'],
  };
};
```

`metro.config.js`：在现有 monorepo 配置外套一层 NativeWind：

```js
const { withNativeWind } = require('nativewind/metro');
// ...现有 getDefaultConfig + watchFolders + nodeModulesPaths...
module.exports = withNativeWind(config, { input: './global.css' });
```

`tailwind.config.js`：

```js
module.exports = {
  content: [
    './App.tsx',
    './src/**/*.{ts,tsx}',
    './node_modules/heroui-native/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
};
```

`global.css`：

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
@import 'heroui-native/styles';
```

`nativewind-env.d.ts`：`/// <reference types="nativewind/types" />`

## 3. Provider

在 `App.tsx` 外层包裹（顺序：手势 → 安全区 → HeroUI）：

```tsx
import 'react-native-gesture-handler';
import './global.css';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { HeroUINativeProvider } from 'heroui-native';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <HeroUINativeProvider>{/* …screens… */}</HeroUINativeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```

> Provider / 组件的确切导出名以 `heroui-native` 安装后的类型定义为准（`node_modules/heroui-native/lib/typescript/src/index.d.ts`）。

## 4. 验证

```bash
pnpm --filter @linkcode/mobile exec expo-doctor   # 检查原生依赖版本是否匹配 SDK 56
pnpm --filter @linkcode/mobile ios                # 或 android —— 需模拟器/真机
```
