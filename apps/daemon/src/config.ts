import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { daemonRuntimeFilePath } from '@linkcode/common/node';
import type { Accounts, ProvidersConfig } from '@linkcode/schema';
import {
  AccountSchema,
  AgentKindSchema,
  DAEMON_DEFAULT_PORT,
  linkcodeStateDirName,
  ProviderConfigSchema,
  parseProfileName,
} from '@linkcode/schema';
import type { TransportServerOptions } from '@linkcode/transport/server';

/**
 * Daemon configuration, loaded from `config.json` in the profile's state dir (optional) with env
 * overrides. Per-provider settings (API keys / default model) are typed by `ProvidersConfigSchema`
 * (data plane) and applied to a session's StartOptions by the Engine; the daemon reads/writes them
 * here.
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

/**
 * The daemon's profile, from `LINKCODE_PROFILE`; `undefined` is the default profile. Each profile
 * is a fully isolated state universe — every path below (and therefore the device identity HQ
 * sees) forks with it. Resolved per call so tests can vary the env like they vary `$HOME`; an
 * invalid name throws and aborts boot rather than silently landing in the default universe.
 */
export function daemonProfile(): string | undefined {
  return parseProfileName(process.env.LINKCODE_PROFILE);
}

/** The daemon's state directory: `~/.linkcode`, or the profile sibling `~/.linkcode-<name>`. */
function stateDir(): string {
  return join(homedir(), linkcodeStateDirName(daemonProfile()));
}

function configPath(): string {
  return join(stateDir(), 'config.json');
}

/** The daemon's SQLite database (session registry), next to config.json. */
export function databasePath(): string {
  return join(stateDir(), 'daemon.db');
}

/** Runtime discovery file advertising the running daemon's bound endpoints, next to config.json. */
export function runtimeFilePath(): string {
  return daemonRuntimeFilePath(daemonProfile());
}

/** HQ sign-in state (session token + registered device id), next to config.json; written 0600. */
export function hqCredentialsPath(): string {
  return join(stateDir(), 'hq.json');
}

/** The device's Ed25519 private key (PKCS#8 PEM), next to config.json; written 0600. */
export function deviceKeyPath(): string {
  return join(stateDir(), 'device-key.pem');
}

/** Hardware-wrapped device-key handles (@arcboxlabs/deviceid), next to config.json. */
export function deviceKeysDir(): string {
  return join(stateDir(), 'keys');
}

/**
 * The daemon-owned chat root: a fixed directory the daemon ensures exists and registers as the
 * `chat`-kind workspace (see `WorkspaceRegistry.ensureChatWorkspace`) backing the sidebar's
 * "Chats" section. Coincides in value with desktop's picker default folder
 * (`ensureDefaultPickerDirectory`) but is owned independently — this is a system-plane invariant
 * the daemon enforces regardless of which client, if any, is connected.
 */
export function chatWorkspaceRoot(): string {
  return join(homedir(), 'LinkCode');
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
 * Parse `file.accounts` element by element: an invalid account (bad shape, unknown agent kind for
 * an oauth credential, …) is dropped and logged rather than discarding the whole pool — one bad
 * entry must not blank out the rest, and `saveAccounts` would otherwise persist that loss on the
 * next write. Mirrors {@link parseProviders}.
 */
function parseAccounts(raw: unknown): Accounts {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    console.error('Invalid accounts config: expected an array, got', raw);
    return [];
  }
  const accounts: Accounts = [];
  for (const value of raw) {
    const account = AccountSchema.safeParse(value);
    if (!account.success) {
      console.error('Invalid account config, dropping entry:', account.error);
      continue;
    }
    accounts.push(account.data);
  }
  return accounts;
}

/**
 * Parse `file.providers` field by field: an invalid entry (unknown agent kind, or a value that
 * fails `ProviderConfigSchema`) is dropped and logged rather than discarding every other,
 * otherwise-valid entry — a single typo must not blank out the rest of the user's config, and
 * `saveProviders` would otherwise persist that loss back to disk on the next write.
 */
function parseProviders(raw: unknown): ProvidersConfig {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    console.error('Invalid providers config: expected an object, got', raw);
    return {};
  }
  const providers: ProvidersConfig = {};
  for (const [key, value] of Object.entries(raw)) {
    const kind = AgentKindSchema.safeParse(key);
    if (!kind.success) {
      console.error(`Invalid providers config: unknown agent kind "${key}"`, kind.error);
      continue;
    }
    const config = ProviderConfigSchema.safeParse(value);
    if (!config.success) {
      console.error(`Invalid providers config for "${key}":`, config.error);
      continue;
    }
    providers[kind.data] = config.data;
  }
  return providers;
}

/**
 * Persist provider config back to `~/.linkcode/config.json`, preserving the file's other fields
 * (listeners / port / host / accounts). Written `0600` since it may hold API keys.
 */
export function saveProviders(providers: ProvidersConfig): void {
  writeConfigField('providers', providers);
}

/**
 * Persist the account pool back to `~/.linkcode/config.json`, preserving the file's other fields.
 * Written `0600` since accounts hold API keys / tokens.
 */
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
