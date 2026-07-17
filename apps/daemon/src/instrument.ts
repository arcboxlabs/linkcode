import { createRequire } from 'node:module';
import * as Sentry from '@sentry/node';

/**
 * Sentry bootstrap, loaded via `--import` so auto-instrumentation installs before anything else is
 * imported — ESM requires this; a top-level `import` in index.ts would run too late (Sentry ESM
 * setup docs). The DSN is publishable, not a secret; without `LINKCODE_SENTRY_DSN` the SDK no-ops.
 *
 * Profiling is optional and loaded with createRequire so the desktop-packaged daemon can ship this
 * file without pulling in `@sentry/profiling-node`'s native binding (wrong ABI under Electron).
 * Standalone Node keeps profiling when the package is installed.
 */
const initOptions: Parameters<typeof Sentry.init>[0] = {
  dsn: process.env.LINKCODE_SENTRY_DSN,
  integrations: [],
  tracesSampleRate: 1,
};

try {
  const require = createRequire(import.meta.url);
  const { nodeProfilingIntegration } =
    require('@sentry/profiling-node') as typeof import('@sentry/profiling-node');
  initOptions.integrations = [nodeProfilingIntegration()];
  initOptions.profileSessionSampleRate = 1;
  initOptions.profileLifecycle = 'trace';
} catch {
  // Native profiler missing or unloadable — error reporting still works.
}

Sentry.init(initOptions);
