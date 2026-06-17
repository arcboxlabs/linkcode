import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Daemon configuration, loaded from `~/.linkcode/config.json` (optional) with env overrides.
 * Per-provider settings (binary paths / API keys / default model) are passed through to adapters via the
 * session's StartOptions.config; this file only configures the daemon's own listener.
 */
export interface DaemonConfig {
  port: number;
  hostname: string;
  /** Free-form per-provider configuration, surfaced to adapters later. */
  providers?: Record<string, unknown>;
}

const DEFAULT_PORT = 4317;
const DEFAULT_HOST = '127.0.0.1';

export function loadConfig(): DaemonConfig {
  const path = join(homedir(), '.linkcode', 'config.json');
  let file: Partial<DaemonConfig> = {};
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as Partial<DaemonConfig>;
  } catch {
    // No config file (or unreadable) — fall back to defaults.
  }
  return {
    port: Number(process.env.LINKCODE_PORT ?? file.port ?? DEFAULT_PORT),
    hostname: process.env.LINKCODE_HOST ?? file.hostname ?? DEFAULT_HOST,
    providers: file.providers,
  };
}
