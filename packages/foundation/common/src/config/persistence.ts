import { decideAntiReplay, isRecord, isUuidV4 } from './contract';
import { evaluateSnapshot } from './evaluation';
import { decodeBase64Url, encodeBase64Url } from './i-json';
import type {
  AntiReplayState,
  ConfigCrypto,
  ConfigDefinitions,
  ConfigEvent,
  ConfigStorage,
  ConfigTarget,
  ConfigValues,
  EvaluationContext,
} from './types';
import { ConfigCoreError } from './types';
import type { ValidatedSnapshot, VerifiedEmergency, VerifiedPointer } from './verification';
import { validateSnapshotBytes, verifyEmergencyBytes, verifyPointerBytes } from './verification';

export interface LoadedLkg<Definitions extends ConfigDefinitions> {
  readonly pointer: VerifiedPointer;
  readonly snapshot: ValidatedSnapshot;
  readonly values: ConfigValues<Definitions>;
}

export interface NormalPersistentState<Definitions extends ConfigDefinitions> {
  readonly etag?: string;
  readonly highWater?: AntiReplayState;
  readonly lkg?: LoadedLkg<Definitions>;
  readonly trusted?: VerifiedPointer;
}

export interface EmergencyPersistentState {
  readonly document?: VerifiedEmergency;
  readonly etag?: string;
  readonly highWater?: AntiReplayState;
}

interface PersistenceOptions<Definitions extends ConfigDefinitions> {
  readonly context: EvaluationContext;
  readonly crypto: ConfigCrypto;
  readonly definitions: Definitions;
  readonly deviceId: string;
  readonly emergencyKeyring: Readonly<Record<string, string>>;
  readonly maximumSchemaVersion: number;
  readonly normalKeyring: Readonly<Record<string, string>>;
  readonly report?: (event: ConfigEvent) => void;
  readonly storage: ConfigStorage;
  readonly target: ConfigTarget;
}

export function normalStorageKey(target: ConfigTarget): string {
  return `linkcode-config:v1:normal:${target.brandId}:${target.platform}:${target.channel}`;
}

export function emergencyStorageKey(target: ConfigTarget): string {
  return `linkcode-config:v1:emergency:${target.brandId}:${target.platform}`;
}

export const DEVICE_ID_STORAGE_KEY = 'linkcode-config:v1:device-id';

export async function loadDeviceId(storage: ConfigStorage, crypto: ConfigCrypto): Promise<string> {
  const stored = await storageGet(storage, DEVICE_ID_STORAGE_KEY);
  if (stored !== null && isUuidV4(stored)) return stored;
  let deviceId: string;
  try {
    deviceId = await crypto.randomUuid();
  } catch (error) {
    throw new ConfigCoreError('crypto-unavailable', 'UUIDv4 generation is unavailable', {
      cause: error,
    });
  }
  if (!isUuidV4(deviceId)) {
    throw new ConfigCoreError('crypto-unavailable', 'UUID generator did not return a UUIDv4');
  }
  await storageSet(storage, DEVICE_ID_STORAGE_KEY, deviceId);
  return deviceId;
}

export async function loadNormalState<Definitions extends ConfigDefinitions>(
  options: PersistenceOptions<Definitions>,
): Promise<NormalPersistentState<Definitions>> {
  const key = normalStorageKey(options.target);
  const stored = await storageGet(options.storage, key);
  if (stored === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch (error) {
    await discardCorrupt(options, key, 'Stored normal state is malformed', error);
    return {};
  }
  if (!isRecord(value) || value.version !== 1) {
    await discardCorrupt(options, key, 'Stored normal state is malformed');
    return {};
  }
  if (value.highWater === undefined && value.trusted === undefined) return {};
  let highWater: AntiReplayState;
  try {
    highWater = parseReplayState(value.highWater);
  } catch (error) {
    await discardCorrupt(options, key, 'Stored normal replay state is malformed', error);
    return {};
  }
  if (!isRecord(value.trusted)) {
    reportCorruption(options, 'Stored trusted pointer is missing');
    await saveNormalState(options.storage, options.target, { highWater });
    return { highWater };
  }

  let trusted: VerifiedPointer;
  try {
    trusted = await verifyStoredPointer(value.trusted.pointer, options);
    if (decideAntiReplay(pointerReplay(trusted), highWater) !== 'idempotent') {
      throw new TypeError('Stored trusted pointer does not match replay state');
    }
  } catch (error) {
    reportCorruption(options, 'Stored trusted pointer failed verification', error);
    await saveNormalState(options.storage, options.target, { highWater });
    return { highWater };
  }
  const etag = typeof value.trusted.etag === 'string' ? value.trusted.etag : undefined;
  let lkg: LoadedLkg<Definitions> | undefined;
  if (value.lkg !== undefined) {
    try {
      if (!isRecord(value.lkg)) throw new TypeError('LKG must be an object');
      const pointer = await verifyStoredPointer(value.lkg.pointer, options);
      const replay = decideAntiReplay(pointerReplay(pointer), highWater);
      if (replay === 'advance' || replay === 'equivocation') {
        throw new TypeError('LKG pointer is inconsistent with trusted high-water');
      }
      if (pointer.document.snapshotSchemaVersion > options.maximumSchemaVersion) {
        throw new TypeError('LKG schema is unsupported');
      }
      const snapshotBytes = decodeStoredBytes(value.lkg.snapshot, 'LKG snapshot');
      const snapshot = await validateSnapshotBytes(
        snapshotBytes,
        pointer.document,
        options.target,
        options.crypto,
      );
      const values = evaluateSnapshot(
        snapshot.document,
        options.definitions,
        options.context,
        options.deviceId,
        options.report,
      );
      lkg = { pointer, snapshot, values };
    } catch (error) {
      reportCorruption(options, 'Stored LKG failed verification', error);
      await saveNormalState(options.storage, options.target, { etag, highWater, trusted });
    }
  }
  return { etag, highWater, lkg, trusted };
}

export async function saveNormalState<Definitions extends ConfigDefinitions>(
  storage: ConfigStorage,
  target: ConfigTarget,
  state: NormalPersistentState<Definitions>,
): Promise<void> {
  const value = {
    version: 1,
    ...(state.highWater && { highWater: state.highWater }),
    ...(state.trusted && {
      trusted: {
        pointer: encodeBase64Url(state.trusted.rawBytes),
        ...(state.etag && { etag: state.etag }),
      },
    }),
    ...(state.lkg && {
      lkg: {
        pointer: encodeBase64Url(state.lkg.pointer.rawBytes),
        snapshot: encodeBase64Url(state.lkg.snapshot.rawBytes),
      },
    }),
  };
  await storageSet(storage, normalStorageKey(target), JSON.stringify(value));
}

export async function loadEmergencyState<Definitions extends ConfigDefinitions>(
  options: PersistenceOptions<Definitions>,
): Promise<EmergencyPersistentState> {
  const key = emergencyStorageKey(options.target);
  const stored = await storageGet(options.storage, key);
  if (stored === null) return {};
  let value: Record<string, unknown>;
  let highWater: AntiReplayState;
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1) {
      throw new TypeError('Emergency state must be an object');
    }
    value = parsed;
    if (value.highWater === undefined && value.document === undefined) return {};
    highWater = parseReplayState(value.highWater);
  } catch (error) {
    await discardCorrupt(options, key, 'Stored emergency state failed verification', error);
    return {};
  }
  if (!isRecord(value.document)) {
    reportCorruption(options, 'Stored emergency document is missing');
    await saveEmergencyState(options.storage, options.target, { highWater });
    return { highWater };
  }
  let document: VerifiedEmergency;
  try {
    const rawBytes = decodeStoredBytes(value.document.raw, 'Emergency document');
    document = await verifyEmergencyBytes(rawBytes, {
      crypto: options.crypto,
      keyring: options.emergencyKeyring,
      target: options.target,
    });
    if (decideAntiReplay(emergencyReplay(document), highWater) !== 'idempotent') {
      throw new TypeError('Stored emergency document does not match replay state');
    }
  } catch (error) {
    reportCorruption(options, 'Stored emergency document failed verification', error);
    await saveEmergencyState(options.storage, options.target, { highWater });
    return { highWater };
  }
  return {
    document,
    etag: typeof value.document.etag === 'string' ? value.document.etag : undefined,
    highWater,
  };
}

export async function saveEmergencyState(
  storage: ConfigStorage,
  target: ConfigTarget,
  state: EmergencyPersistentState,
): Promise<void> {
  const value = {
    version: 1,
    ...(state.highWater && { highWater: state.highWater }),
    ...(state.document && {
      document: {
        raw: encodeBase64Url(state.document.rawBytes),
        ...(state.etag && { etag: state.etag }),
      },
    }),
  };
  await storageSet(storage, emergencyStorageKey(target), JSON.stringify(value));
}

async function verifyStoredPointer<Definitions extends ConfigDefinitions>(
  value: unknown,
  options: PersistenceOptions<Definitions>,
): Promise<VerifiedPointer> {
  const rawBytes = decodeStoredBytes(value, 'Stored pointer');
  return verifyPointerBytes(rawBytes, {
    crypto: options.crypto,
    keyring: options.normalKeyring,
    target: options.target,
  });
}

function decodeStoredBytes(value: unknown, label: string): Uint8Array {
  if (typeof value !== 'string') throw new TypeError(`${label} must be Base64URL`);
  return decodeBase64Url(value);
}

function parseReplayState(value: unknown): AntiReplayState {
  if (
    !isRecord(value) ||
    typeof value.version !== 'string' ||
    typeof value.payloadSha256 !== 'string'
  ) {
    throw new TypeError('Replay state must contain string version and payloadSha256 fields');
  }
  const highWater = { payloadSha256: value.payloadSha256, version: value.version };
  decideAntiReplay(highWater, null);
  return highWater;
}

function pointerReplay(pointer: VerifiedPointer): AntiReplayState {
  return {
    payloadSha256: pointer.payloadSha256,
    version: pointer.document.activationVersion,
  };
}

function emergencyReplay(document: VerifiedEmergency): AntiReplayState {
  return {
    payloadSha256: document.payloadSha256,
    version: document.document.emergencyVersion,
  };
}

async function discardCorrupt<Definitions extends ConfigDefinitions>(
  options: PersistenceOptions<Definitions>,
  key: string,
  message: string,
  cause?: unknown,
): Promise<void> {
  reportCorruption(options, message, cause);
  await storageSet(options.storage, key, JSON.stringify({ version: 1 }));
}

function reportCorruption<Definitions extends ConfigDefinitions>(
  options: PersistenceOptions<Definitions>,
  message: string,
  cause?: unknown,
): void {
  options.report?.({
    type: 'error',
    operation: 'initialize',
    error: new ConfigCoreError('storage', message, { cause }),
  });
}

async function storageGet(storage: ConfigStorage, key: string): Promise<string | null> {
  try {
    return await storage.get(key);
  } catch (error) {
    throw new ConfigCoreError('storage', `Failed to read ${key}`, { cause: error });
  }
}

async function storageSet(storage: ConfigStorage, key: string, value: string): Promise<void> {
  try {
    await storage.set(key, value);
  } catch (error) {
    throw new ConfigCoreError('storage', `Failed to write ${key}`, { cause: error });
  }
}
