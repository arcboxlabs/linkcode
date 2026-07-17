import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

/**
 * Sentry bootstrap, loaded via `--import` so auto-instrumentation installs before anything else is
 * imported — ESM requires this; a top-level `import` in index.ts would run too late (Sentry ESM
 * setup docs). The DSN is publishable, not a secret; without `LINKCODE_SENTRY_DSN` the SDK no-ops.
 */
Sentry.init({
  dsn: process.env.LINKCODE_SENTRY_DSN,
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: 1,
  profileSessionSampleRate: 1,
  profileLifecycle: 'trace',
});
