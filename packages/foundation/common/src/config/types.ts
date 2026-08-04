export const CONFIG_CONTRACT_VERSION = 1;
export const MAX_SNAPSHOT_SIZE_BYTES = 1024 * 1024;
export const MAX_MONOTONIC_VERSION = '18446744073709551615';

export const CONFIG_PLATFORMS = ['desktop', 'ios', 'android'] as const;
export const CONFIG_CHANNELS = ['canary', 'stable'] as const;
export const APPLY_MODES = ['hot', 'cold'] as const;
export const OPERATING_SYSTEMS = ['windows', 'macos', 'linux', 'ios', 'android'] as const;

export type ConfigPlatform = (typeof CONFIG_PLATFORMS)[number];
export type ConfigChannel = (typeof CONFIG_CHANNELS)[number];
export type ApplyMode = (typeof APPLY_MODES)[number];
export type OperatingSystem = (typeof OPERATING_SYSTEMS)[number];

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];
export type ConfigValue = Exclude<JsonValue, null>;

export interface ConfigTarget {
  readonly brandId: string;
  readonly platform: ConfigPlatform;
  readonly channel: ConfigChannel;
}

export interface OverrideCondition {
  readonly appVersion?: string;
  readonly locale?: string;
  readonly os?: OperatingSystem;
}

export interface ConfigOverride {
  readonly when: OverrideCondition;
  readonly set: Readonly<Record<string, JsonValue>>;
}

export interface ConfigRollout {
  readonly basisPoints: number;
  readonly salt: string;
  readonly value: boolean;
}

export interface ConfigSnapshot extends ConfigTarget {
  readonly applyModes: Readonly<Record<string, ApplyMode>>;
  readonly configVersion: string;
  readonly contractVersion: 1;
  readonly generatedAt: string;
  readonly overrides: readonly ConfigOverride[];
  readonly rollouts: Readonly<Record<string, ConfigRollout>>;
  readonly schemaVersion: number;
  readonly values: Readonly<Record<string, ConfigValue>>;
}

export interface ConfigPointer extends ConfigTarget {
  readonly activationVersion: string;
  readonly configVersion: string;
  readonly contractVersion: 1;
  readonly createdAt: string;
  readonly keyId: string;
  readonly sha256: string;
  readonly sig: string;
  readonly sizeBytes: number;
  readonly snapshotSchemaVersion: number;
}

export interface EmergencyNotice {
  readonly body: string;
  readonly title: string;
  readonly url: string | null;
}

export interface EmergencyDocument {
  readonly brandId: string;
  readonly contractVersion: 1;
  readonly createdAt: string;
  readonly disabledFeatures: readonly string[];
  readonly emergencyVersion: string;
  readonly forceMinVersion: string | null;
  readonly keyId: string;
  readonly notice: EmergencyNotice | null;
  readonly platform: ConfigPlatform;
  readonly sig: string;
}

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
