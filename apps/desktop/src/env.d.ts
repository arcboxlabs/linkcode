/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Inlined into the main bundle at build time (signed builds only; see docs/RELEASE.md).
  readonly MAIN_VITE_SENTRY_DSN?: string;
  /** Public PostHog project configuration; both values are required or analytics no-ops. */
  readonly RENDERER_VITE_POSTHOG_PROJECT_TOKEN?: string;
  readonly RENDERER_VITE_POSTHOG_HOST?: string;
}

// Resolved by the assetPlugin in vite.shared.ts to an absolute path next to the bundle.
declare module '*?asset' {
  const src: string;
  export default src;
}

declare namespace NodeJS {
  interface ProcessEnv {
    // Set by scripts/dev.mts before spawning Electron; read by src/main/window.ts.
    ELECTRON_RENDERER_URL?: string;
  }
}
