import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TransportServerOptions } from '@linkcode/transport/server';

/**
 * Daemon configuration, loaded from `~/.linkcode/config.json` (optional) with env overrides.
 * Per-provider settings (binary paths / API keys / default model) are passed through to adapters via the
 * session's StartOptions.config; this file only configures the daemon's own listeners.
 */
export type DaemonListenerConfig = TransportServerOptions;

export interface DaemonConfig {
  listeners: DaemonListenerConfig[];
  /** Free-form per-provider configuration, surfaced to adapters later. */
  providers?: Record<string, unknown>;
}

const DEFAULT_PORT = 4317;
const DEFAULT_HOST = '127.0.0.1';

interface ConfigFile {
  port?: unknown;
  hostname?: unknown;
  listeners?: unknown;
  providers?: Record<string, unknown>;
}

export function loadConfig(): DaemonConfig {
  const path = join(homedir(), '.linkcode', 'config.json');
  let file: ConfigFile = {};
  try {
    file = JSON.parse(readFileSync(path, 'utf8')) as ConfigFile;
  } catch {
    // No config file (or unreadable) — fall back to defaults.
  }
  const fallbackListener = createDefaultSocketIoListener(file);
  const configuredListeners = Array.isArray(file.listeners)
    ? file.listeners.flatMap((value) => {
        const listener = parseListener(value);
        return listener ? [listener] : [];
      })
    : [];

  return {
    listeners: applyEnvOverrides(
      configuredListeners.length > 0 ? configuredListeners : [fallbackListener],
    ),
    providers: file.providers,
  };
}

function createDefaultSocketIoListener(file: ConfigFile): DaemonListenerConfig {
  return {
    type: 'socket.io',
    port: parsePort(file.port, DEFAULT_PORT),
    host: parseString(file.hostname, DEFAULT_HOST),
  };
}

function parseListener(value: unknown): DaemonListenerConfig | null {
  if (!isRecord(value)) return null;
  if (value.type !== 'socket.io' && value.type !== 'ws') return null;
  return {
    type: value.type,
    port: parsePort(value.port, DEFAULT_PORT),
    host: parseString(value.host ?? value.hostname, DEFAULT_HOST),
  };
}

function applyEnvOverrides(listeners: DaemonListenerConfig[]): DaemonListenerConfig[] {
  const envPort = process.env.LINKCODE_PORT;
  const envHost = process.env.LINKCODE_HOST;
  if (!envPort && !envHost) return listeners;
  return listeners.map((listener) => ({
    ...listener,
    port: parsePort(envPort, listener.port),
    host: parseString(envHost, listener.host ?? DEFAULT_HOST),
  }));
}

function parsePort(value: unknown, fallback: number): number {
  const port = Number(value);
  return Number.isSafeInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function parseString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
