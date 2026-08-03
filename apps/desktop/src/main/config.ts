import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ConfigCrypto,
  ConfigDefinitions,
  ConfigEvent,
  ConfigNetwork,
  ConfigRefreshResult,
  ConfigStorage,
  ConfigValue,
  JsonValue,
  OperatingSystem,
} from '@linkcode/common/config';
import {
  applyConfigPatch,
  ConfigCore,
  ConfigCoreError,
  canonicalizeJson,
  definitionsFromDefaults,
} from '@linkcode/common/config';
import { app } from 'electron';
import log from 'electron-log';
import { nullthrow } from 'foxts/guard';
import { isObjectEmpty } from 'foxts/is-object-empty';
import type {
  ConfigRefreshReport,
  ConfigRefreshStatus,
  ConfigSnapshotInfo,
  EffectiveConfigSnapshot,
} from '../shared/config';
import { AtomicConfigStorage, FetchConfigNetwork, nodeConfigCrypto } from './config-adapters';
import { initializeDesktopConfigTelemetry, recordDesktopConfigEvent } from './config-telemetry';
import { CHANNEL } from './constants';

const FIRST_REFRESH_DELAY_MS = 3000;
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MANUAL_REFRESH_COOLDOWN_MS = 1000;

const disabledNetwork: ConfigNetwork = {
  get() {
    return Promise.reject(new ConfigCoreError('fetch', 'Configuration endpoint is disabled'));
  },
};

export interface DesktopConfigBootstrap {
  readonly brandId: string;
  readonly channel: 'canary' | 'stable';
  readonly defaults: Readonly<Record<string, ConfigValue>>;
  readonly emergencyEndpoint: string | null;
  readonly emergencyPublicKeys: Readonly<Record<string, string>>;
  readonly endpoint: string | null;
  readonly maximumSchemaVersion: number;
  readonly publicKeys: Readonly<Record<string, string>>;
  /** Authenticated telemetry endpoint for this target; carried by every generated build bundle.
   * Bootstrap data only — telemetry behavior is out of scope here (CODE-555). */
  readonly telemetryEndpoint: string | null;
}

export interface DesktopConfigServiceOptions {
  readonly bootstrap: DesktopConfigBootstrap;
  readonly context: { appVersion: string; locale: string; os: OperatingSystem };
  readonly crypto: ConfigCrypto;
  readonly emergencyNetwork?: ConfigNetwork;
  readonly network?: ConfigNetwork;
  readonly onEvent?: (event: ConfigEvent) => void;
  readonly storage: ConfigStorage;
}

type HotUpdateListener = (keys: readonly string[]) => void;

export class DesktopConfigService {
  readonly #core: ConfigCore<ConfigDefinitions>;
  readonly #listeners = new Set<HotUpdateListener>();
  readonly #normalEnabled: boolean;
  readonly #emergencyEnabled: boolean;
  #snapshot: EffectiveConfigSnapshot;
  #refreshPromise: Promise<ConfigRefreshReport> | null = null;
  #lastRefresh: { readonly completedAt: number; readonly report: ConfigRefreshReport } | null =
    null;

  constructor(options: DesktopConfigServiceOptions) {
    const definitions = definitionsFromDefaults(options.bootstrap.defaults);
    this.#normalEnabled = options.network !== undefined;
    this.#emergencyEnabled = options.emergencyNetwork !== undefined;
    this.#core = new ConfigCore({
      context: options.context,
      crypto: options.crypto,
      definitions,
      emergencyKeyring: options.bootstrap.emergencyPublicKeys,
      emergencyNetwork: options.emergencyNetwork ?? disabledNetwork,
      maximumSchemaVersion: options.bootstrap.maximumSchemaVersion,
      network: options.network ?? disabledNetwork,
      normalKeyring: options.bootstrap.publicKeys,
      report(event) {
        reportConfigEvent(event);
        options.onEvent?.(event);
      },
      storage: options.storage,
      target: {
        brandId: options.bootstrap.brandId,
        channel: options.bootstrap.channel,
        platform: 'desktop',
      },
    });
    this.#snapshot = cloneSnapshot(options.bootstrap.defaults);
  }

  async initialize(): Promise<void> {
    const state = await this.#core.initialize();
    this.#snapshot = cloneSnapshot(state.values);
    this.#core.subscribe((next) => {
      const previous = this.#snapshot;
      this.#snapshot = cloneSnapshot(next.values);
      const changed = changedKeys(previous, this.#snapshot);
      if (changed.length === 0) return;
      for (const listener of this.#listeners) listener(changed);
    });
  }

  effectiveSnapshot(): EffectiveConfigSnapshot {
    return cloneSnapshot(this.#snapshot);
  }

  snapshotInfo(): ConfigSnapshotInfo {
    const state = this.#core.getState();
    return {
      configVersion: state.configVersion,
      sha256: state.sha256,
      source: state.source === 'defaults' ? 'bundled' : state.source === 'lkg' ? 'cache' : 'remote',
      stagedColdKeys: state.stagedColdKeys.map(String),
      status: 'READY',
    };
  }

  refresh(): Promise<ConfigRefreshReport> {
    if (this.#refreshPromise) return this.#refreshPromise;
    if (
      this.#lastRefresh &&
      Date.now() - this.#lastRefresh.completedAt < MANUAL_REFRESH_COOLDOWN_MS
    ) {
      return Promise.resolve(this.#lastRefresh.report);
    }
    const refresh = this.#performRefresh().then((report) => {
      this.#lastRefresh = { completedAt: Date.now(), report };
      return report;
    });
    this.#refreshPromise = refresh;
    void refresh.finally(() => {
      if (this.#refreshPromise === refresh) this.#refreshPromise = null;
    });
    return refresh;
  }

  async #performRefresh(): Promise<ConfigRefreshReport> {
    const [normal, emergency] = await Promise.all([
      this.#normalEnabled ? this.#core.refresh() : undefined,
      this.#emergencyEnabled ? this.#core.refreshEmergency() : undefined,
    ]);
    return {
      emergency: refreshStatus(emergency),
      normal: refreshStatus(normal),
      snapshotInfo: this.snapshotInfo(),
    };
  }

  onHotUpdate(listener: HotUpdateListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

let service: DesktopConfigService | null = null;
let refreshTimeout: NodeJS.Timeout | null = null;
let refreshInterval: NodeJS.Timeout | null = null;

export async function initializeDesktopConfig(
  getSessionCookie: () => string,
): Promise<DesktopConfigService> {
  const bootstrap = parseBootstrap(import.meta.env.MAIN_VITE_CONFIG_BOOTSTRAP);
  const configDirectory = join(app.getPath('userData'), 'config');
  const defaults = await loadEffectiveDefaults(
    bootstrap.defaults,
    join(configDirectory, 'override.json'),
    !app.isPackaged,
  );
  const storage = new AtomicConfigStorage(configDirectory);
  initializeDesktopConfigTelemetry({
    appVersion: app.getVersion(),
    bootstrap,
    getCookie: getSessionCookie,
    storage,
  });
  const candidate = new DesktopConfigService({
    bootstrap: { ...bootstrap, defaults },
    context: {
      appVersion: app.getVersion(),
      locale: app.getLocale(),
      os: operatingSystem(process.platform),
    },
    crypto: nodeConfigCrypto,
    onEvent: recordDesktopConfigEvent,
    ...(bootstrap.endpoint &&
      !isObjectEmpty(bootstrap.publicKeys) && {
        network: new FetchConfigNetwork(bootstrap.endpoint),
      }),
    ...(bootstrap.emergencyEndpoint &&
      !isObjectEmpty(bootstrap.emergencyPublicKeys) && {
        emergencyNetwork: new FetchConfigNetwork(bootstrap.emergencyEndpoint),
      }),
    storage,
  });
  await candidate.initialize();
  service = candidate;
  return candidate;
}

export function getDesktopConfig(): DesktopConfigService {
  return nullthrow(service, 'Desktop configuration has not initialized');
}

export function startDesktopConfigRefresh(): void {
  refreshTimeout = setTimeout(() => {
    refreshDesktopConfig();
    refreshInterval = setInterval(refreshDesktopConfig, REFRESH_INTERVAL_MS);
    refreshInterval.unref();
  }, FIRST_REFRESH_DELAY_MS);
  refreshTimeout.unref();
}

export function stopDesktopConfigRefresh(): void {
  if (refreshTimeout) clearTimeout(refreshTimeout);
  if (refreshInterval) clearInterval(refreshInterval);
  refreshTimeout = null;
  refreshInterval = null;
}

export async function loadEffectiveDefaults(
  defaults: Readonly<Record<string, ConfigValue>>,
  overridePath: string,
  allowOverride: boolean,
): Promise<Readonly<Record<string, ConfigValue>>> {
  if (!allowOverride) return cloneSnapshot(defaults);
  try {
    const parsed = JSON.parse(await readFile(overridePath, 'utf8')) as unknown;
    if (!isRecord(parsed)) throw new TypeError('Local config override must be an object');
    const patched = applyConfigPatch(defaults, parsed as Readonly<Record<string, JsonValue>>);
    return Object.fromEntries(
      Object.entries(patched).filter((entry) => entry[1] !== null),
    ) as Record<string, ConfigValue>;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return cloneSnapshot(defaults);
    log.warn('Ignoring invalid local config override');
    return cloneSnapshot(defaults);
  }
}

export function parseBootstrap(raw: string | undefined): DesktopConfigBootstrap {
  if (!raw) {
    return {
      brandId: 'linkcode',
      channel: CHANNEL === 'release' ? 'stable' : 'canary',
      defaults: {},
      emergencyEndpoint: null,
      emergencyPublicKeys: {},
      endpoint: null,
      maximumSchemaVersion: 1,
      publicKeys: {},
      telemetryEndpoint: null,
    };
  }
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value) || !isRecord(value.defaults)) {
    throw new TypeError('Invalid config bootstrap');
  }
  if (
    typeof value.brandId !== 'string' ||
    (value.channel !== 'canary' && value.channel !== 'stable') ||
    typeof value.maximumSchemaVersion !== 'number' ||
    !Number.isSafeInteger(value.maximumSchemaVersion) ||
    value.maximumSchemaVersion < 1
  ) {
    throw new TypeError('Invalid config bootstrap');
  }
  const endpoint = parseEndpoint(value.endpoint);
  const emergencyEndpoint = parseEndpoint(value.emergencyEndpoint);
  return {
    brandId: value.brandId,
    channel: value.channel,
    defaults: parseConfigValues(value.defaults),
    emergencyEndpoint,
    emergencyPublicKeys: parseKeyring(value.emergencyPublicKeys),
    endpoint,
    maximumSchemaVersion: value.maximumSchemaVersion,
    publicKeys: parseKeyring(value.publicKeys),
    telemetryEndpoint: parseEndpoint(value.telemetryEndpoint ?? null),
  };
}

function refreshStatus(result: ConfigRefreshResult | undefined): ConfigRefreshStatus {
  return result?.status ?? 'disabled';
}

function reportConfigEvent(event: ConfigEvent): void {
  if (event.type === 'error') {
    log.warn(`Config ${event.operation} failed: ${event.error.code}`);
  } else if (event.type === 'invalid-runtime-app-version') {
    log.warn('Config runtime app version is invalid');
  }
}

function changedKeys(
  previous: EffectiveConfigSnapshot,
  next: EffectiveConfigSnapshot,
): readonly string[] {
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter((key) => canonicalizeJson(previous[key]) !== canonicalizeJson(next[key]))
    .sort();
}

function cloneSnapshot(values: Readonly<Record<string, ConfigValue>>): EffectiveConfigSnapshot {
  return structuredClone(values);
}

function parseEndpoint(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || new URL(value).protocol !== 'https:') {
    throw new TypeError('Config endpoints must use HTTPS');
  }
  return value;
}

function parseKeyring(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) throw new TypeError('Config keyrings must contain strings');
  const keyring: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') throw new TypeError('Config keyrings must contain strings');
    keyring[key] = entry;
  }
  return keyring;
}

function parseConfigValues(value: Record<string, unknown>): Readonly<Record<string, ConfigValue>> {
  const defaults: Record<string, ConfigValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isConfigValue(entry)) throw new TypeError('Config defaults must contain JSON values');
    defaults[key] = structuredClone(entry);
  }
  return defaults;
}

function isConfigValue(value: unknown): value is ConfigValue {
  if (value === null) return false;
  if (typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry));
  return isRecord(value) && Object.values(value).every((entry) => isJsonValue(entry));
}

function isJsonValue(value: unknown): value is JsonValue {
  return value === null || isConfigValue(value);
}

function operatingSystem(platform: NodeJS.Platform): OperatingSystem {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}

function refreshDesktopConfig(): void {
  void getDesktopConfig().refresh();
}
