/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Inlined at build time. Publishable id; empty in local dev unless set. */
  readonly VITE_SENTRY_DSN?: string;
  /** Public PostHog project configuration; both values are required or analytics no-ops. */
  readonly VITE_POSTHOG_PROJECT_TOKEN?: string;
  readonly VITE_POSTHOG_HOST?: string;
  /** Override LinkCode Cloud API base; defaults to https://api.linkcode.ai. */
  readonly VITE_LINKCODE_CLOUD_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
