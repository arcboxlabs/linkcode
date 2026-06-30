import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

/**
 * Sentry bootstrap, loaded via `node --import` (prod) / `tsx --import` (dev) so the SDK installs its
 * auto-instrumentation before the engine, transport, or any agent SDK is imported — ESM requires this,
 * a top-level `import` in index.ts would run too late (see Sentry's ESM setup docs).
 *
 * The DSN is a publishable identifier, not a secret. With no `LINKCODE_SENTRY_DSN` the SDK no-ops, so
 * local runs report nothing unless the env var is set.
 */
Sentry.init({
  dsn: process.env.LINKCODE_SENTRY_DSN,
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: 1,
  profileSessionSampleRate: 1,
  profileLifecycle: 'trace',
});
