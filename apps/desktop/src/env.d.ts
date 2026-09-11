/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Inlined into the main bundle at build time (signed builds only; see docs/RELEASE.md).
  readonly MAIN_VITE_SENTRY_DSN?: string;
  /** Build-time immutable config bootstrap; unset builds stay on bundled defaults. When
   * apps/desktop/generated holds a rendered build bundle (config:render), vite.main.config.mts
   * inlines the derived bootstrap and rejects any ambient env value. */
  readonly MAIN_VITE_CONFIG_BOOTSTRAP?: string;
  /** Build-time immutable brand identity artifact (config:render, CODE-558); unset builds are
   * the default LinkCode identity. Inlined only from generated output — never from ambient env,
   * which vite.main.config.ts rejects outright. */
  readonly MAIN_VITE_BRAND_IDENTITY?: string;
  /** Build-time agent/service restriction snapshot (config:render, CODE-618); unset builds are
   * unrestricted. Inlined only from generated output — never from ambient env, which
   * vite.main.config.ts rejects outright. */
  readonly MAIN_VITE_AGENT_RESTRICTIONS?: string;
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
