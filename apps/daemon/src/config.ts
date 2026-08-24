import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { daemonRuntimeFilePath } from '@linkcode/common/node';
import type {
  Accounts,
  AgentKind,
  CustomMcpServer,
  ProvidersConfig,
  SimulatorConsentState,
} from '@linkcode/schema';
import {
  AccountSchema,
  AgentKindSchema,
  CustomMcpServerSchema,
  daemonBasePort,
  ProviderConfigSchema,
  SimulatorConsentStateSchema,
} from '@linkcode/schema';
import { workspacesDirName } from '@linkcode/schema/product';
import type { TransportServerOptions } from '@linkcode/transport/server';
import { extractErrorMessage, isErrorLikeObject } from 'foxts/extract-error-message';
import { logger } from './logger';
import { daemonChannel, daemonProfile, daemonStateDir } from './paths';
import type { SecretStore, SecretVault } from './secrets';
import { detachCustomMcpSecrets, withCustomMcpSecrets } from './secrets/custom-mcp-credentials';
import {
  detachAccountSecrets,
  detachProviderSecrets,
  withAccountSecret,
  withProviderSecret,
} from './secrets/provider-credentials';

export { daemonChannel, daemonProfile } from './paths';

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
  /** LinkCode-owned custom MCP servers (data plane); undefined when nothing is configured. */
  customMcpServers?: CustomMcpServer[];
  /** Which simulators agents may drive, plus the global agent-tools switch (CODE-420). */
  simulatorConsent: SimulatorConsentState;
}

const DEFAULT_HOST = '127.0.0.1';

interface ConfigFile {
  port?: unknown;
  hostname?: unknown;
  listeners?: unknown;
  providers?: unknown;
  accounts?: unknown;
  customMcpServers?: unknown;
  simulatorConsent?: unknown;
}

function configPath(): string {
  return join(daemonStateDir(), 'config.json');
}

/** The daemon's SQLite database (session registry), next to config.json. */
export function databasePath(): string {
  return join(daemonStateDir(), 'daemon.db');
}

/** Daemon-owned root for managed git worktrees. */
export function worktreeRoot(): string {
  return join(daemonStateDir(), 'worktrees');
}

/**
 * Restricted-brand agent allowlist (CODE-618): `LINKCODE_ALLOWED_AGENTS` — injected by the desktop
 * supervisor from the build's identity, comma-separated — gates which adapter kinds this daemon
 * will spawn. Absent (the default, unbranded build) means unrestricted: `null`, never an empty
 * array, so every downstream check can treat "no restriction" as "skip the check".
 */
export function daemonAllowedAgents(): readonly AgentKind[] | null {
  const raw = process.env.LINKCODE_ALLOWED_AGENTS;
  if (raw === undefined || raw === '') return null;
  const kinds = raw.split(',').map((entry) => AgentKindSchema.parse(entry.trim()));
  return kinds.length > 0 ? kinds : null;
}

/** Runtime discovery file advertising the running daemon's bound endpoints, next to config.json. */
export function runtimeFilePath(): string {
  return daemonRuntimeFilePath(daemonChannel(), daemonProfile());
}

/** LinkCode Cloud sign-in state (origin + registered device id), next to config.json; written 0600.
 * The session token is not in it — that lives in the secret vault (CODE-371). */
export function cloudCredentialsPath(): string {
  return join(daemonStateDir(), 'cloud.json');
}

/** Pre-rename name of {@link cloudCredentialsPath}, read once to migrate and then removed. */
export function legacyHqCredentialsPath(): string {
  return join(daemonStateDir(), 'hq.json');
}

/**
 * Where the software device key used to sit as a bare PKCS#8 PEM. It lives in the secret vault now
 * (CODE-371); this path is read once to migrate the existing key — which keeps the device id, and
 * therefore the cloud registration, stable — and then removed.
 */
export function legacyDeviceKeyPath(): string {
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
  return join(homedir(), workspacesDirName(daemonChannel()));
}

/** `config.json` opens its vault namespaces itself rather than being handed refs. */
const providerSecrets = (vault: SecretVault): SecretStore => vault.namespace('provider');
const accountSecrets = (vault: SecretVault): SecretStore => vault.namespace('account');
const customMcpSecrets = (vault: SecretVault): SecretStore => vault.namespace('custom-mcp');

export function loadConfig(vault: SecretVault): DaemonConfig {
  const file = readConfigFile();
  const fallbackListener = createDefaultSocketIoListener(file);
  const configuredListeners = Array.isArray(file.listeners)
    ? file.listeners.flatMap((value) => {
        const listener = parseListener(value);
        return listener ? [listener] : [];
      })
    : [];

  const parsedProviders = parseProviders(providerSecrets(vault), file.providers);
  const parsedAccounts = parseAccounts(accountSecrets(vault), file.accounts);

  // Parsing already moved every inline secret into the vault and told us so; rewriting is what takes
  // the exposed copies off disk. Done here, at the read that found them, so an upgrade needs no user
  // action.
  const parsedCustomMcp = parseCustomMcpServers(customMcpSecrets(vault), file.customMcpServers);
  if (parsedProviders.migrated || parsedAccounts.migrated || parsedCustomMcp.migrated) {
    logger.warn(
      { operation: 'config.load' },
      'Moving credentials out of config.json into the secret vault',
    );
    saveConfigSnapshot(vault, parsedProviders.value, parsedAccounts.value, parsedCustomMcp.value);
  }

  return {
    listeners: applyEnvOverrides(
      configuredListeners.length > 0 ? configuredListeners : [fallbackListener],
    ),
    providers: parsedProviders.value,
    accounts: parsedAccounts.value,
    customMcpServers: parsedCustomMcp.value,
    simulatorConsent: parseSimulatorConsent(file.simulatorConsent),
  };
}

/** A parsed collection plus whether any of its entries carried an inline secret to migrate. */
interface Parsed<T> {
  value: T;
  migrated: boolean;
}

/**
 * A malformed blob falls back to "nothing decided yet", which re-asks rather than silently
 * granting: consent is the one field where losing state must fail closed.
 */
function parseSimulatorConsent(raw: unknown): SimulatorConsentState {
  const empty: SimulatorConsentState = { entries: [], agentToolsEnabled: true };
  if (raw === undefined) return empty;
  const parsed = SimulatorConsentStateSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ operation: 'config.load' }, 'Dropping invalid simulator consent config');
    return empty;
  }
  return parsed.data;
}

/** Persist simulator agent-consent to config.json, preserving its other fields; `0600`. */
export function saveSimulatorConsent(state: SimulatorConsentState): void {
  writeConfigFields(readConfigFile(), { simulatorConsent: state });
}

/**
 * Parse element by element: an invalid account is dropped and logged, never blanking the pool —
 * a later save would persist that loss. Mirrors {@link parseProviders}.
 */
function parseAccounts(store: SecretStore, raw: unknown): Parsed<Accounts> {
  if (raw === undefined) return { value: [], migrated: false };
  if (!Array.isArray(raw)) {
    logger.warn({ operation: 'config.load' }, 'Invalid accounts config: expected an array');
    return { value: [], migrated: false };
  }
  const accounts: Accounts = [];
  let migrated = false;
  for (const value of raw) {
    // The credential secret lives in the vault (CODE-371); merge it back before validating, so a
    // secret that is gone fails the schema and lands in the same drop-and-log path as a malformed one.
    const attached = withAccountSecret(store, value);
    migrated ||= attached.migrated;
    const account = AccountSchema.safeParse(withPickedModels(attached.value));
    if (!account.success) {
      logger.warn({ operation: 'config.load' }, 'Dropping invalid account config');
      continue;
    }
    accounts.push(account.data);
  }
  return { value: accounts, migrated };
}

/** Pre-selection configs stored one free-text model per account; carry it over as the picked set,
 * or zod strips the unknown key and the user silently loses their model. Idempotent. */
function withPickedModels(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const { model, ...rest } = value as { model?: unknown; models?: unknown };
  if (typeof model !== 'string' || model === '' || rest.models !== undefined) return rest;
  return { ...rest, models: [{ id: model }] };
}

/**
 * An agent's only per-account state is now which accounts it offers, so the default account and
 * default model are dropped on read — zod would strip them anyway. The default account is folded
 * into the enabled list first: it was necessarily an account the user meant this agent to use, and
 * an explicit list that omitted it would silently take it away.
 */
function withEnabledAccounts(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const {
    activeAccountId,
    defaultModel: _model,
    model: _pick,
    ...rest
  } = value as { activeAccountId?: unknown; defaultModel?: unknown; model?: unknown } & {
    enabledAccountIds?: unknown;
  };
  if (typeof activeAccountId !== 'string' || activeAccountId === '') return rest;
  const enabled = rest.enabledAccountIds;
  if (!Array.isArray(enabled)) return rest;
  return enabled.includes(activeAccountId)
    ? rest
    : { ...rest, enabledAccountIds: [...enabled, activeAccountId] };
}

/**
 * Parse element by element like {@link parseAccounts}: one invalid server is dropped and logged,
 * never blanking the rest.
 */
function parseCustomMcpServers(store: SecretStore, raw: unknown): Parsed<CustomMcpServer[]> {
  const snapshot = parseCustomMcpSnapshot(raw);
  if (snapshot.servers === undefined) return { value: [], migrated: false };
  if (!Array.isArray(snapshot.servers)) {
    logger.warn({ operation: 'config.load' }, 'Invalid custom MCP config: expected an array');
    return { value: [], migrated: false };
  }
  const servers: CustomMcpServer[] = [];
  let migrated = false;
  for (const value of snapshot.servers) {
    const attached = withCustomMcpSecrets(store, value, snapshot.generation);
    migrated ||= attached.migrated;
    const server = CustomMcpServerSchema.safeParse(attached.value);
    if (!server.success) {
      logger.warn({ operation: 'config.load' }, 'Dropping invalid custom MCP server config');
      continue;
    }
    servers.push(server.data);
  }
  return { value: servers, migrated };
}

/**
 * Parse field by field: an invalid entry is dropped and logged, never blanking the other entries —
 * a later save would persist that loss.
 */
function parseProviders(store: SecretStore, raw: unknown): Parsed<ProvidersConfig> {
  if (raw === undefined) return { value: {}, migrated: false };
  if (!isRecord(raw)) {
    logger.warn({ operation: 'config.load' }, 'Invalid providers config: expected an object');
    return { value: {}, migrated: false };
  }
  const providers: ProvidersConfig = {};
  let migrated = false;
  for (const [key, value] of Object.entries(raw)) {
    const kind = AgentKindSchema.safeParse(key);
    if (!kind.success) {
      logger.warn(
        { agentKind: key, operation: 'config.load' },
        'Dropping config for unknown agent kind',
      );
      continue;
    }
    const attached = withProviderSecret(store, kind.data, value);
    migrated ||= attached.migrated;
    const config = ProviderConfigSchema.safeParse(withEnabledAccounts(attached.value));
    if (!config.success) {
      logger.warn({ agentKind: key, operation: 'config.load' }, 'Dropping invalid provider config');
      continue;
    }
    providers[kind.data] = config.data;
  }
  return { value: providers, migrated };
}

/** Persist providers and accounts in one config.json replacement; their secrets go to the vault. */
export function saveProviderConfiguration(
  vault: SecretVault,
  providers: ProvidersConfig,
  accounts: Accounts,
): void {
  const file = readConfigFile();
  writeConfigFields(file, {
    providers: detachProviderSecrets(providerSecrets(vault), providers),
    accounts: detachAccountSecrets(accountSecrets(vault), accounts),
  });
}

function readConfigFile(): ConfigFile & Record<string, unknown> {
  const path = configPath();
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch (err) {
    if (isErrorLikeObject(err) && (err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Could not read daemon config at ${path}: ${extractErrorMessage(err)}`, {
      cause: err,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    throw new SyntaxError(`Invalid JSON in daemon config at ${path}: ${extractErrorMessage(err)}`, {
      cause: err,
    });
  }

  if (!isRecord(parsed)) {
    throw new TypeError(`Invalid daemon config at ${path}: expected a JSON object`);
  }
  return parsed;
}

/** Persist custom MCP structure and key names; values go to the vault. */
export function saveCustomMcpServers(
  vault: SecretVault,
  servers: CustomMcpServer[],
  previous: CustomMcpServer[],
): void {
  persistCustomMcpSnapshot(vault, servers, previous, (value) =>
    writeConfigFields(readConfigFile(), { customMcpServers: value }),
  );
}

export function saveConfigSnapshot(
  vault: SecretVault,
  providers: ProvidersConfig,
  accounts: Accounts,
  customMcpServers: CustomMcpServer[],
): void {
  persistCustomMcpSnapshot(vault, customMcpServers, customMcpServers, (value) =>
    writeConfigFields(readConfigFile(), {
      providers: detachProviderSecrets(providerSecrets(vault), providers),
      accounts: detachAccountSecrets(accountSecrets(vault), accounts),
      customMcpServers: value,
    }),
  );
}

interface CustomMcpSnapshot {
  generation: number | undefined;
  servers: unknown;
}

function parseCustomMcpSnapshot(raw: unknown): CustomMcpSnapshot {
  if (raw === undefined || Array.isArray(raw)) return { generation: undefined, servers: raw };
  if (
    isRecord(raw) &&
    raw.v === 1 &&
    typeof raw.generation === 'number' &&
    Number.isSafeInteger(raw.generation) &&
    raw.generation > 0 &&
    Array.isArray(raw.servers)
  ) {
    return { generation: raw.generation, servers: raw.servers };
  }
  return { generation: undefined, servers: raw };
}

function persistCustomMcpSnapshot(
  vault: SecretVault,
  servers: CustomMcpServer[],
  previous: CustomMcpServer[],
  writeConfig: (value: unknown) => void,
): void {
  const store = customMcpSecrets(vault);
  const previousGeneration = parseCustomMcpSnapshot(readConfigFile().customMcpServers).generation;
  const generation =
    previousGeneration === undefined || previousGeneration === Number.MAX_SAFE_INTEGER
      ? 1
      : previousGeneration + 1;
  const before = detachCustomMcpSecrets(previous, previousGeneration);
  const after = detachCustomMcpSecrets(servers, generation);
  const combined = new Map(before.secrets);
  for (const [key, secret] of after.secrets) combined.set(key, secret);
  store.replaceAll(combined);
  try {
    writeConfig({ v: 1, generation, servers: after.servers });
  } catch (error) {
    try {
      store.replaceAll(before.secrets);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Failed to persist or restore custom MCP', {
        cause: rollbackError,
      });
    }
    throw error;
  }
  try {
    store.replaceAll(after.secrets);
  } catch (err) {
    logger.warn(
      { err, operation: 'config.save-custom-mcp' },
      'Custom MCP state committed but stale secret cleanup failed',
    );
  }
}

function fsyncPath(path: string): void {
  const descriptor = openSync(path, 'r');
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeConfigFields(
  file: Record<string, unknown>,
  fields: Partial<Record<keyof ConfigFile, unknown>>,
): void {
  const path = configPath();
  Object.assign(file, fields);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = join(directory, `.config.${process.pid}.${randomUUID()}.tmp`);
  try {
    const descriptor = openSync(temporaryPath, 'wx', 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8' });
      chmodSync(temporaryPath, 0o600);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporaryPath, path);
    if (process.platform !== 'win32') fsyncPath(directory);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function createDefaultSocketIoListener(file: ConfigFile): DaemonListenerConfig {
  return {
    type: 'socket.io',
    port: parsePort(file.port, daemonBasePort(daemonChannel())),
    host: parseString(file.hostname, DEFAULT_HOST),
  };
}

function parseListener(value: unknown): DaemonListenerConfig | null {
  if (!isRecord(value)) return null;
  if (value.type !== 'socket.io' && value.type !== 'ws') return null;
  return {
    type: value.type,
    port: parsePort(value.port, daemonBasePort(daemonChannel())),
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
