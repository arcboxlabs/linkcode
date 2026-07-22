/// <reference types="expo/types" />

// NOTE: Committed stand-in for the gitignored, CLI-generated expo-env.d.ts so fresh
// checkouts typecheck without running Expo first (provides *.css module typing).

declare namespace NodeJS {
  interface ProcessEnv {
    /** Inlined by Metro/EAS at bundle time. Publishable id; empty unless set. */
    EXPO_PUBLIC_SENTRY_DSN?: string;
    /** Public PostHog project configuration; both values are required or analytics no-ops. */
    EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN?: string;
    EXPO_PUBLIC_POSTHOG_HOST?: string;
  }
}

// Metro resolves image imports to bundler asset sources; expo/types ships no
// declaration for them.
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';

  const source: ImageSourcePropType;
  export default source;
}
