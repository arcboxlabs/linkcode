import { readFileSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { sanitizeSentryTransaction } from '@linkcode/common/sentry';
import type { TelemetryConfig } from '@linkcode/common/telemetry-config';
import {
  DEFAULT_TELEMETRY_CONFIG,
  fetchTelemetryConfig,
  parseTelemetryConfig,
} from '@linkcode/common/telemetry-config';
import * as Sentry from '@sentry/node';
import { noop } from 'foxts/noop';
import { sanitizeDiagnostic } from './diagnostic-sanitizer';
import { daemonStateDir, telemetryConfigCachePath } from './paths';

/**
 * Sentry bootstrap, loaded via `--import` so auto-instrumentation installs before anything else is
 * imported — ESM requires this; a top-level `import` in index.ts would run too late (Sentry ESM
 * setup docs). The DSN is publishable, not a secret; without `LINKCODE_SENTRY_DSN` the SDK no-ops.
 *
 * Profiling is optional and loaded with createRequire so the desktop-packaged daemon can ship this
 * file without pulling in `@sentry/profiling-node`'s native binding (wrong ABI under Electron).
 * Standalone Node keeps profiling when the package is installed.
 */
const integrations = [
  Sentry.pinoIntegration({
    log: { levels: [] },
    error: { levels: ['error', 'fatal'], handled: true },
  }),
];
const telemetryConfigPath = telemetryConfigCachePath();
const cachedTelemetryConfig = readCachedTelemetryConfig();
let daemonTraceSampleRate = DEFAULT_TELEMETRY_CONFIG.sentry.tracesSampleRate.daemon;

const initOptions: Parameters<typeof Sentry.init>[0] = {
  dsn: process.env.LINKCODE_SENTRY_DSN,
  enableLogs: false,
  sendDefaultPii: false,
  integrations,
  tracesSampler: ({ inheritOrSampleWith }) => inheritOrSampleWith(daemonTraceSampleRate),
  beforeSend: sanitizeDiagnostic,
  beforeSendTransaction: (event) =>
    sanitizeSentryTransaction(event, { fallbackTransactionName: 'daemon request' }),
};

try {
  const require = createRequire(import.meta.url);
  const { nodeProfilingIntegration } =
    require('@sentry/profiling-node') as typeof import('@sentry/profiling-node');
  integrations.push(nodeProfilingIntegration());
  initOptions.profileSessionSampleRate =
    cachedTelemetryConfig.sentry.profileSessionSampleRate.daemon;
  initOptions.profileLifecycle = 'trace';
} catch {
  // Native profiler missing or unloadable — error reporting still works.
}

Sentry.init(initOptions);
void refreshTelemetryConfig();

function readCachedTelemetryConfig(): TelemetryConfig {
  try {
    return (
      parseTelemetryConfig(JSON.parse(readFileSync(telemetryConfigPath, 'utf8'))) ??
      DEFAULT_TELEMETRY_CONFIG
    );
  } catch {
    return DEFAULT_TELEMETRY_CONFIG;
  }
}

async function refreshTelemetryConfig(): Promise<void> {
  const config = await Sentry.suppressTracing(fetchTelemetryConfig);
  if (!config) return;
  daemonTraceSampleRate = config.sentry.tracesSampleRate.daemon;
  const temporaryPath = `${telemetryConfigPath}.${process.pid}.tmp`;
  try {
    await mkdir(daemonStateDir(), { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, telemetryConfigPath);
  } catch {
    await unlink(temporaryPath).catch(noop);
    // The trace sampler is already updated; an unwritable cache only delays profiler changes.
  }
}
