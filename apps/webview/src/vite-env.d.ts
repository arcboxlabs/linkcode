/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Inlined at build time. Publishable id; empty in local dev unless set. */
  readonly VITE_SENTRY_DSN?: string;
  /** Override LinkCode Cloud API base; defaults to https://api.linkcode.ai. */
  readonly VITE_LINKCODE_CLOUD_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
