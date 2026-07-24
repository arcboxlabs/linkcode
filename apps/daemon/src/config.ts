import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { daemonRuntimeFilePath } from '@linkcode/common/node';
import type { Accounts, ProvidersConfig } from '@linkcode/schema';
import {
  AccountSchema,
  AgentKindSchema,
  DAEMON_DEFAULT_PORT,
  ProviderConfigSchema,
} from '@linkcode/schema';
import { WORKSPACES_DIRNAME } from '@linkcode/schema/product';
import type { TransportServerOptions } from '@linkcode/transport/server';
import { logger } from './logger';
import { daemonProfile, daemonStateDir } from './paths';

export { daemonProfile } from './paths';

/**
 * Daemon configuration: `config.json` in the profile's state dir (optional) with env overrides.
 * Per-provider settings are typed by `ProvidersConfigSchema` and applied to a session's
 * StartOptions by the Engine; the daemon only reads/writes them here.
 */
export type DaemonListenerConfig = TransportServerOptions;

export interface DaemonConfig {
  listeners: DaemonListenerConfig[];
  /** Typed per-provider configuration (data plane); undefined when nothing is configured. */
  providers?: ProvidersConfig;
  /** Global account pool (data plane); undefined when nothing is configured. */
  accounts?: Accounts;
}

const DEFAULT_PORT = DAEMON_DEFAULT_PORT;
const DEFAULT_HOST = '127.0.0.1';

interface ConfigFile {
  port?: unknown;
  hostname?: unknown;
  listeners?: unknown;
  providers?: unknown;
  accounts?: unknown;
}

function configPath(): string {
  return join(daemonStateDir(), 'config.json');
}

/** The daemon's SQLite database (session registry), next to config.json. */
export function databasePath(): string {
  return join(daemonStateDir(), 'daemon.db');
}

/** Runtime discovery file advertising the running daemon's bound endpoints, next to config.json. */
export function runtimeFilePath(): string {
  return daemonRuntimeFilePath(daemonProfile());
}

/** HQ sign-in state (session token + registered device id), next to config.json; written 0600. */
export function hqCredentialsPath(): string {
  return join(daemonStateDir(), 'hq.json');
}

/** The device's Ed25519 private key (PKCS#8 PEM), next to config.json; written 0600. */
export function deviceKeyPath(): string {
  return join(daemonStateDir(), 'device-key.pem');
}

/** Hardware-wrapped device-key handles (@arcboxlabs/deviceid), next to config.json. */
export function deviceKeysDir(): string {
  return join(daemonStateDir(), 'keys');
}

/**
 * Daemon-owned chat root, registered as the `chat`-kind workspace backing the sidebar's "Chats".
 * Coincides in value with desktop's picker default (`ensureDefaultPickerDirectory`) but is owned
 * independently — a system-plane invariant enforced regardless of which client is connected.
 */
export function chatWorkspaceRoot(): string {
  return join(homedir(), WORKSPACES_DIRNAME);
}

export function loadConfig(): DaemonConfig {
  let file: ConfigFile = {};
  try {
    file = JSON.parse(readFileSync(configPath(), 'utf8')) as ConfigFile;
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
    providers: parseProviders(file.providers),
    accounts: parseAccounts(file.accounts),
  };
}

/**
 * Parse element by element: an invalid account is dropped and logged, never blanking the pool —
 * `saveAccounts` would persist that loss on the next write. Mirrors {@link parseProviders}.
 */
function parseAccounts(raw: unknown): Accounts {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    logger.warn({ operation: 'config.load' }, 'Invalid accounts config: expected an array');
    return [];
  }
  const accounts: Accounts = [];
  for (const value of raw) {
    const account = AccountSchema.safeParse(value);
    if (!account.success) {
      logger.warn({ operation: 'config.load' }, 'Dropping invalid account config');
      continue;
    }
    accounts.push(account.data);
  }
  return accounts;
}

/**
 * Parse field by field: an invalid entry is dropped and logged, never blanking the other entries —
 * `saveProviders` would persist that loss on the next write.
 */
function parseProviders(raw: unknown): ProvidersConfig {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    logger.warn({ operation: 'config.load' }, 'Invalid providers config: expected an object');
    return {};
  }
  const providers: ProvidersConfig = {};
  for (const [key, value] of Object.entries(raw)) {
    const kind = AgentKindSchema.safeParse(key);
    if (!kind.success) {
      logger.warn(
        { agentKind: key, operation: 'config.load' },
        'Dropping config for unknown agent kind',
      );
      continue;
    }
    const config = ProviderConfigSchema.safeParse(value);
    if (!config.success) {
      logger.warn({ agentKind: key, operation: 'config.load' }, 'Dropping invalid provider config');
      continue;
    }
    providers[kind.data] = config.data;
  }
  return providers;
}

/** Persist providers to config.json, preserving its other fields; `0600` (may hold API keys). */
export function saveProviders(providers: ProvidersConfig): void {
  writeConfigField('providers', providers);
}

/** Persist the account pool to config.json, preserving its other fields; `0600` (holds API keys / tokens). */
export function saveAccounts(accounts: Accounts): void {
  writeConfigField('accounts', accounts);
}

/** Read-modify-write a single top-level field of config.json, preserving the rest; `0600`. */
function writeConfigField(key: 'providers' | 'accounts', value: unknown): void {
  const path = configPath();
  let file: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (isRecord(parsed)) file = parsed;
  } catch {
    // Start from an empty document if the file is missing or malformed.
  }
  file[key] = value;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
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
