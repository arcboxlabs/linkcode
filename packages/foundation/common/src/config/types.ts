import type { ConfigValue, EmergencyNotice, OperatingSystem } from '@linkcode/schema/remote-config';

export type {
  ApplyMode,
  ConfigChannel,
  ConfigOverride,
  ConfigPlatform,
  ConfigPointer,
  ConfigRollout,
  ConfigSnapshot,
  ConfigTarget,
  ConfigValue,
  EmergencyDocument,
  EmergencyNotice,
  JsonValue,
  OperatingSystem,
  OverrideCondition,
} from '@linkcode/schema/remote-config';
export {
  APPLY_MODES,
  CONFIG_CHANNELS,
  CONFIG_CONTRACT_VERSION,
  CONFIG_PLATFORMS,
  MAX_MONOTONIC_VERSION,
  MAX_SNAPSHOT_SIZE_BYTES,
  OPERATING_SYSTEMS,
} from '@linkcode/schema/remote-config';

export type JsonPrimitive = boolean | number | string | null;

export interface EvaluationContext {
  readonly appVersion: string;
  readonly locale: string;
  readonly os: OperatingSystem;
}

export interface AntiReplayState {
  readonly payloadSha256: string;
  readonly version: string;
}

export type AntiReplayDecision = 'advance' | 'equivocation' | 'idempotent' | 'replay';

export interface ConfigNetworkRequest {
  readonly etag?: string;
}

export interface ConfigNetworkResponse {
  readonly status: number;
  // The body must be the exact response bytes, without text decoding.
  readonly body?: Uint8Array;
  readonly etag?: string;
}

export interface ConfigNetwork {
  get(path: string, request: ConfigNetworkRequest): Promise<ConfigNetworkResponse>;
}

export interface ConfigStorage {
  get(key: string): Promise<string | null>;
  // Implementations must atomically replace the complete value.
  set(key: string, value: string): Promise<void>;
}

export interface ConfigCrypto {
  randomUuid(): Promise<string> | string;
  sha256(bytes: Uint8Array): Promise<Uint8Array>;
  verifyEd25519(
    publicKey: Uint8Array,
    signature: Uint8Array,
    message: Uint8Array,
  ): Promise<boolean>;
}

export interface ConfigValueDefinition<Value extends ConfigValue = ConfigValue> {
  readonly defaultValue: Value;
  readonly parse: (value: ConfigValue) => Value;
}

export type ConfigDefinitions = Readonly<Record<string, ConfigValueDefinition>>;

export type ConfigValues<Definitions extends ConfigDefinitions> = {
  readonly [Key in keyof Definitions]: Definitions[Key] extends ConfigValueDefinition<infer Value>
    ? Value
    : never;
};

export type ConfigErrorCode =
  | 'crypto-unavailable'
  | 'equivocation'
  | 'fetch'
  | 'hash-mismatch'
  | 'invalid-key-length'
  | 'invalid-signature'
  | 'invalid-signature-length'
  | 'malformed'
  | 'malformed-key'
  | 'malformed-signature'
  | 'replay'
  | 'schema-invalid'
  | 'size-mismatch'
  | 'storage'
  | 'target-mismatch'
  | 'unknown-key'
  | 'unsupported-contract'
  | 'unsupported-schema';

export class ConfigCoreError extends Error {
  readonly code: ConfigErrorCode;

  // eslint-disable-next-line sukka/unicorn/custom-error-definition -- The mandatory code precedes the diagnostic.
  constructor(code: ConfigErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConfigCoreError';
    this.code = code;
  }
}

export interface ConfigErrorEvent {
  readonly type: 'error';
  readonly operation: 'emergency-refresh' | 'initialize' | 'normal-refresh';
  readonly error: ConfigCoreError;
}

export interface InvalidRuntimeVersionEvent {
  readonly type: 'invalid-runtime-app-version';
  readonly value: string;
}

export type ConfigEvent = ConfigErrorEvent | InvalidRuntimeVersionEvent;

export type ConfigRefreshResult =
  | { readonly status: 'idempotent' | 'not-modified' | 'updated' }
  | { readonly status: 'error'; readonly error: ConfigCoreError };

export interface ConfigEmergencyState {
  readonly disabledFeatures: readonly string[];
  readonly emergencyVersion: string;
  readonly forceMinVersion: string | null;
  readonly notice: EmergencyNotice | null;
}

/** Smallest host-facing emergency view: enough to enforce a forced minimum and inspect the
 * accepted disable overlay, without exposing wire or persistence internals. */
export interface EmergencyHostState {
  readonly disabledFeatures: readonly string[];
  readonly emergencyVersion: string;
  readonly forceMinVersion: string | null;
  readonly updateRequired: boolean;
}

export interface ConfigRuntimeState<Values> {
  readonly configVersion: string | null;
  readonly emergency: ConfigEmergencyState | null;
  readonly sha256: string | null;
  readonly source: 'defaults' | 'lkg' | 'remote';
  readonly stagedColdKeys: ReadonlyArray<keyof Values>;
  readonly values: Values;
}
