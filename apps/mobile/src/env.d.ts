/// <reference types="expo/types" />

// NOTE: Committed stand-in for the gitignored, CLI-generated expo-env.d.ts so fresh
// checkouts typecheck without running Expo first (provides *.css module typing).

// Metro resolves image imports to bundler asset sources; expo/types ships no
// declaration for them.
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const source: ImageSourcePropType;
  export default source;
}
