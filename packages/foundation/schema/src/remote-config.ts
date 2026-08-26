import canonicalize from 'canonicalize';
import { z } from 'zod';

export const CONFIG_CONTRACT_VERSION = 1;
export const CONFIG_BUILD_BUNDLE_VERSION = 1;
export const MAX_SNAPSHOT_SIZE_BYTES = 1024 * 1024;
export const MAX_MONOTONIC_VERSION = '18446744073709551615';

export const CONFIG_PLATFORMS = ['desktop', 'ios', 'android'] as const;
export const CONFIG_CHANNELS = ['canary', 'stable'] as const;
export const APPLY_MODES = ['hot', 'cold'] as const;
export const OPERATING_SYSTEMS = ['windows', 'macos', 'linux', 'ios', 'android'] as const;
// Duplicated from AgentKindSchema (./model/primitives.ts) rather than imported, same as
// CONFIG_PLATFORMS/CONFIG_CHANNELS above stay local: this file is also reached via
// `@linkcode/schema/remote-config` from build-time scripts running under plain Node
// (config-bundle.mts), which — unlike a bundler or tsx — cannot resolve an extensionless
// relative import across files. Keep in sync with AgentKindSchema's options by hand.
const CONFIG_BUNDLE_AGENT_KINDS = ['claude-code', 'codex', 'opencode', 'pi', 'grok-build'] as const;

const RE_BRAND_ID = /^[a-z][a-z0-9-]{0,62}$/;
const RE_SERVICE_ID = /^[a-z][a-z0-9-]{0,62}$/;
const RE_CONFIG_KEY = /^(?:app|content|feature|modules|params|ui)(?:\.[a-z][A-Za-z0-9]*)+$/;
const RE_CONFIG_VERSION = /^[\dA-Z][\w.-]{0,127}$/i;
const RE_DECIMAL = /^(?:0|[1-9]\d*)$/;
const RE_KEY_ID = /^[\dA-Z][\w.-]{0,127}$/i;
const RE_LOCALE_SUBTAG = /^[\dA-Z]{1,8}$/i;
const RE_NUMERIC_IDENTIFIER = /^\d+$/;
const RE_REVISION_ID = /^[\dA-Z][\w.-]{0,127}$/i;
const RE_SEMVER_IDENTIFIER = /^[\dA-Z-]+$/i;
const RE_SHA256 = /^[0-9a-f]{64}$/;
const RE_SIGNATURE = /^[\w-]{85}[AQgw]$/;
const RE_SOURCE_GIT_SHA = /^[0-9a-f]{40}$/;
const RE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const RecordWithoutProtoSchema = z.custom<Record<string, unknown>>(
  (value) => isRecord(value) && !Object.hasOwn(value, '__proto__'),
  { message: 'Must not contain an own __proto__ member' },
);

export const JsonValueSchema = z.json();
export type JsonValue = z.infer<typeof JsonValueSchema>;

export const ConfigValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]);
export type ConfigValue = z.infer<typeof ConfigValueSchema>;

const SignedJsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.string(),
    z.number().int(),
    z.array(SignedJsonValueSchema),
    z.record(z.string(), SignedJsonValueSchema),
  ]),
);

export const ConfigPlatformSchema = z.enum(CONFIG_PLATFORMS);
export type ConfigPlatform = z.infer<typeof ConfigPlatformSchema>;
export const ConfigChannelSchema = z.enum(CONFIG_CHANNELS);
export type ConfigChannel = z.infer<typeof ConfigChannelSchema>;
export const ApplyModeSchema = z.enum(APPLY_MODES);
export type ApplyMode = z.infer<typeof ApplyModeSchema>;
export const OperatingSystemSchema = z.enum(OPERATING_SYSTEMS);
export type OperatingSystem = z.infer<typeof OperatingSystemSchema>;

export const BrandIdSchema = z.string().regex(RE_BRAND_ID);
export const Sha256Schema = z.string().regex(RE_SHA256);
const ConfigVersionSchema = z.string().regex(RE_CONFIG_VERSION);
const KeyIdSchema = z.string().regex(RE_KEY_ID);
const SignatureSchema = z.string().regex(RE_SIGNATURE);
const SchemaVersionSchema = z.number().int().positive();
const TimestampSchema = z.string().refine(isValidTimestamp, {
  message: 'Must use valid RFC 3339 UTC seconds precision',
});
const MonotonicVersionSchema = z.string().refine(isMonotonicVersion, {
  message: 'Must be a canonical uint64 decimal string',
});

export const ConfigTargetSchema = z.strictObject({
  brandId: BrandIdSchema,
  channel: ConfigChannelSchema,
  platform: ConfigPlatformSchema,
});
export type ConfigTarget = z.infer<typeof ConfigTargetSchema>;

export const OverrideConditionSchema = RecordWithoutProtoSchema.pipe(
  z
    .strictObject({
      appVersion: z
        .string()
        .refine(isValidVersionRange, { message: 'Invalid version range' })
        .optional(),
      locale: z.string().refine(isValidLocale, { message: 'Invalid locale' }).optional(),
      os: OperatingSystemSchema.optional(),
    })
    .refine(
      (condition) =>
        condition.appVersion !== undefined ||
        condition.locale !== undefined ||
        condition.os !== undefined,
      { message: 'Must not be empty' },
    ),
);
export type OverrideCondition = z.infer<typeof OverrideConditionSchema>;

export const ConfigOverrideSchema = z
  .object({
    set: RecordWithoutProtoSchema.pipe(z.record(z.string(), JsonValueSchema)),
    when: OverrideConditionSchema,
  })
  .catchall(JsonValueSchema);
export type ConfigOverride = z.infer<typeof ConfigOverrideSchema>;

export const ConfigRolloutSchema = RecordWithoutProtoSchema.pipe(
  z.strictObject({
    basisPoints: z.number().int().min(0).max(10000),
    salt: z.string().refine((value) => {
      const length = new TextEncoder().encode(value).byteLength;
      return length >= 1 && length <= 128;
    }, 'Must contain 1 to 128 UTF-8 bytes'),
    value: z.boolean(),
  }),
);
export type ConfigRollout = z.infer<typeof ConfigRolloutSchema>;

export const ConfigSnapshotSchema = z
  .object({
    applyModes: RecordWithoutProtoSchema.pipe(z.record(z.string(), ApplyModeSchema)),
    brandId: BrandIdSchema,
    channel: ConfigChannelSchema,
    configVersion: ConfigVersionSchema,
    contractVersion: z.literal(CONFIG_CONTRACT_VERSION),
    generatedAt: TimestampSchema,
    overrides: z.array(ConfigOverrideSchema),
    platform: ConfigPlatformSchema,
    rollouts: RecordWithoutProtoSchema.pipe(z.record(z.string(), ConfigRolloutSchema)),
    schemaVersion: SchemaVersionSchema,
    values: RecordWithoutProtoSchema.pipe(z.record(z.string(), ConfigValueSchema)),
  })
  .catchall(JsonValueSchema)
  .superRefine((snapshot, context) => {
    const coveredKeys = new Set<string>();
    for (const [key, value] of Object.entries(snapshot.values)) {
      if (!isConfigKey(key)) {
        context.addIssue({
          code: 'custom',
          message: `Invalid config key ${key}`,
          path: ['values'],
        });
      }
      if (typeof value !== 'boolean' && key.startsWith('feature.')) {
        context.addIssue({
          code: 'custom',
          message: 'Feature values must be boolean',
          path: ['values', key],
        });
      }
      coveredKeys.add(key);
    }
    for (const [index, override] of snapshot.overrides.entries()) {
      for (const [key, value] of Object.entries(override.set)) {
        if (!isConfigKey(key)) {
          context.addIssue({
            code: 'custom',
            message: `Invalid config key ${key}`,
            path: ['overrides', index, 'set'],
          });
        }
        if (value !== null && typeof value !== 'boolean' && key.startsWith('feature.')) {
          context.addIssue({
            code: 'custom',
            message: 'Feature values must be boolean or null',
            path: ['overrides', index, 'set', key],
          });
        }
        coveredKeys.add(key);
      }
    }
    for (const key of Object.keys(snapshot.rollouts)) {
      if (!key.startsWith('feature.') || !isConfigKey(key)) {
        context.addIssue({
          code: 'custom',
          message: `Rollout key ${key} must be a feature key`,
          path: ['rollouts'],
        });
      }
      coveredKeys.add(key);
    }
    for (const key of Object.keys(snapshot.applyModes)) {
      if (!isConfigKey(key)) {
        context.addIssue({
          code: 'custom',
          message: `Invalid config key ${key}`,
          path: ['applyModes'],
        });
      }
    }
    for (const key of coveredKeys) {
      if (!Object.hasOwn(snapshot.applyModes, key)) {
        context.addIssue({
          code: 'custom',
          message: `Missing apply mode for ${key}`,
          path: ['applyModes'],
        });
      }
    }
  });
export type ConfigSnapshot = z.infer<typeof ConfigSnapshotSchema>;

const ConfigBuildEndpointSchema = z.string().superRefine((endpoint, context) => {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    context.addIssue({ code: 'custom', message: 'Endpoint must be an absolute URL' });
    return;
  }
  if (url.protocol !== 'https:') {
    context.addIssue({ code: 'custom', message: 'Endpoint must use HTTPS' });
  }
  if (url.username || url.password || url.search || url.hash) {
    context.addIssue({
      code: 'custom',
      message: 'Endpoint must not carry credentials, query, or fragment',
    });
  }
});
const OptionalConfigBuildEndpointSchema = z.union([z.null(), ConfigBuildEndpointSchema]);
const ConfigBuildKeyringSchema = RecordWithoutProtoSchema.pipe(z.record(KeyIdSchema, z.string()));

export const ConfigBuildBundleEndpointsSchema = z.strictObject({
  emergency: OptionalConfigBuildEndpointSchema,
  normal: OptionalConfigBuildEndpointSchema,
  telemetry: ConfigBuildEndpointSchema,
});
export type ConfigBuildBundleEndpoints = z.infer<typeof ConfigBuildBundleEndpointsSchema>;

export const ConfigBuildBundleKeyringsSchema = z.strictObject({
  emergency: ConfigBuildKeyringSchema,
  normal: ConfigBuildKeyringSchema,
});
export type ConfigBuildBundleKeyrings = z.infer<typeof ConfigBuildBundleKeyringsSchema>;

export const ConfigBuildBundleProvenanceSchema = z.strictObject({
  configRevisionId: z.string().regex(RE_REVISION_ID),
  configVersion: ConfigVersionSchema,
  generatedAt: TimestampSchema,
  schemaVersion: SchemaVersionSchema,
  sourceGitSha: z.string().regex(RE_SOURCE_GIT_SHA, 'Must be an exact lowercase 40-hex commit'),
});
export type ConfigBuildBundleProvenance = z.infer<typeof ConfigBuildBundleProvenanceSchema>;

export const ConfigBuildBundleSnapshotEnvelopeSchema = z.strictObject({
  base64Url: z.string(),
  sha256: Sha256Schema,
  sizeBytes: z.number().int().min(1).max(MAX_SNAPSHOT_SIZE_BYTES),
});
export type ConfigBuildBundleSnapshotEnvelope = z.infer<
  typeof ConfigBuildBundleSnapshotEnvelopeSchema
>;

export const ConfigBuildBundleSchema = z
  .strictObject({
    // Absent = unrestricted (every agent/service allowed); a brand only ever narrows this set.
    agents: z.array(z.enum(CONFIG_BUNDLE_AGENT_KINDS)).min(1).optional(),
    brandId: BrandIdSchema,
    buildBundleVersion: z.literal(CONFIG_BUILD_BUNDLE_VERSION),
    channel: ConfigChannelSchema,
    endpoints: ConfigBuildBundleEndpointsSchema,
    keyrings: ConfigBuildBundleKeyringsSchema,
    maximumSchemaVersion: z.number().int(),
    platform: ConfigPlatformSchema,
    provenance: ConfigBuildBundleProvenanceSchema,
    // Free-form ids (this package must not depend on the providers catalog); shape-checked only.
    services: z.array(z.string().regex(RE_SERVICE_ID)).min(1).optional(),
    snapshot: ConfigBuildBundleSnapshotEnvelopeSchema,
  })
  .superRefine((bundle, context) => {
    for (const kind of ['normal', 'emergency'] as const) {
      if (
        (bundle.endpoints[kind] === null) !==
        (Object.keys(bundle.keyrings[kind]).at(0) === undefined)
      ) {
        context.addIssue({
          code: 'custom',
          message: `${kind} endpoint and keyring must be enabled together`,
          path: ['keyrings', kind],
        });
      }
    }
    if (bundle.agents !== undefined && new Set(bundle.agents).size !== bundle.agents.length) {
      context.addIssue({
        code: 'custom',
        message: 'agents must not contain duplicates',
        path: ['agents'],
      });
    }
    if (bundle.services !== undefined && new Set(bundle.services).size !== bundle.services.length) {
      context.addIssue({
        code: 'custom',
        message: 'services must not contain duplicates',
        path: ['services'],
      });
    }
    if (bundle.maximumSchemaVersion < bundle.provenance.schemaVersion) {
      context.addIssue({
        code: 'custom',
        message: 'maximumSchemaVersion must cover the snapshot schema version',
        path: ['maximumSchemaVersion'],
      });
    }
  });
export type ConfigBuildBundle = z.infer<typeof ConfigBuildBundleSchema>;

export const ConfigPointerSchema = z
  .object({
    activationVersion: MonotonicVersionSchema,
    brandId: BrandIdSchema,
    channel: ConfigChannelSchema,
    configVersion: ConfigVersionSchema,
    contractVersion: z.literal(CONFIG_CONTRACT_VERSION),
    createdAt: TimestampSchema,
    keyId: KeyIdSchema,
    platform: ConfigPlatformSchema,
    sha256: Sha256Schema,
    sig: SignatureSchema,
    sizeBytes: z.number().int().min(1).max(MAX_SNAPSHOT_SIZE_BYTES),
    snapshotSchemaVersion: SchemaVersionSchema,
  })
  .catchall(SignedJsonValueSchema);
export type ConfigPointer = z.infer<typeof ConfigPointerSchema>;

export const EmergencyNoticeSchema = RecordWithoutProtoSchema.pipe(
  z.strictObject({
    body: z.string().min(1).max(1000),
    title: z.string().min(1).max(120),
    url: z.union([z.null(), z.string().max(2048).startsWith('https://')]),
  }),
);
export type EmergencyNotice = z.infer<typeof EmergencyNoticeSchema>;

export const EmergencyDocumentSchema = z
  .object({
    brandId: BrandIdSchema,
    contractVersion: z.literal(CONFIG_CONTRACT_VERSION),
    createdAt: TimestampSchema,
    disabledFeatures: z.array(z.string()),
    emergencyVersion: MonotonicVersionSchema,
    forceMinVersion: z.union([
      z.null(),
      z.string().refine(isValidSemver, { message: 'Invalid semantic version' }),
    ]),
    keyId: KeyIdSchema,
    notice: z.union([z.null(), EmergencyNoticeSchema]),
    platform: ConfigPlatformSchema,
    sig: SignatureSchema,
  })
  .catchall(SignedJsonValueSchema)
  .superRefine((document, context) => {
    for (const [index, key] of document.disabledFeatures.entries()) {
      if (!key.startsWith('feature.') || !isConfigKey(key)) {
        context.addIssue({
          code: 'custom',
          message: 'Disabled feature must be a feature key',
          path: ['disabledFeatures', index],
        });
      }
    }
    const sorted = [...new Set(document.disabledFeatures)].sort();
    if (
      sorted.length !== document.disabledFeatures.length ||
      sorted.some((value, index) => value !== document.disabledFeatures[index])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Disabled features must be sorted and unique',
        path: ['disabledFeatures'],
      });
    }
  });
export type EmergencyDocument = z.infer<typeof EmergencyDocumentSchema>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isConfigKey(value: string): boolean {
  return RE_CONFIG_KEY.test(value);
}

export function canonicalizeJson(value: JsonValue): string {
  return z.string().parse(canonicalize(value));
}

export function assertMonotonicVersion(value: string, label = 'version'): void {
  if (!isMonotonicVersion(value)) {
    throw new TypeError(`${label} must be a canonical uint64 decimal string`);
  }
}

export function compareMonotonicVersions(left: string, right: string): number {
  assertMonotonicVersion(left, 'left version');
  assertMonotonicVersion(right, 'right version');
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function canonicalSignedPayload(document: unknown): string {
  if (!isRecord(document)) throw new TypeError('signed envelope must be an object');
  SignatureSchema.parse(document.sig);
  const unsigned = Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'sig'));
  assertSignedEnvelopeValue(unsigned, 'signed envelope payload');
  return canonicalizeJson(unsigned);
}

export function canonicalSignedPayloadBytes(document: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalSignedPayload(document));
}

export function assertConfigTarget(value: unknown): asserts value is ConfigTarget {
  ConfigTargetSchema.parse(value);
}

export function assertConfigPointer(value: unknown): asserts value is ConfigPointer {
  canonicalSignedPayload(value);
  ConfigPointerSchema.parse(value);
}

export function assertConfigSnapshot(value: unknown): asserts value is ConfigSnapshot {
  if (!isRecord(value)) throw new TypeError('snapshot must be an object');
  canonicalizeJson(value as JsonValue);
  ConfigSnapshotSchema.parse(value);
}

export function assertConfigBuildBundle(value: unknown): asserts value is ConfigBuildBundle {
  ConfigBuildBundleSchema.parse(value);
}

export function assertEmergencyDocument(value: unknown): asserts value is EmergencyDocument {
  canonicalSignedPayload(value);
  EmergencyDocumentSchema.parse(value);
}

function isMonotonicVersion(value: string): boolean {
  return (
    RE_DECIMAL.test(value) &&
    (value.length < MAX_MONOTONIC_VERSION.length ||
      (value.length === MAX_MONOTONIC_VERSION.length && value <= MAX_MONOTONIC_VERSION))
  );
}

function isValidTimestamp(value: string): boolean {
  if (!RE_TIMESTAMP.test(value)) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value.replace('Z', '.000Z');
}

function isValidLocale(value: string): boolean {
  return value
    .replaceAll('_', '-')
    .split('-')
    .every((subtag) => RE_LOCALE_SUBTAG.test(subtag));
}

function isValidSemver(value: string): boolean {
  const plusParts = value.split('+');
  if (plusParts.length > 2) return false;
  const versionAndPrerelease = plusParts[0];
  const build = plusParts.length === 2 ? plusParts[1] : null;
  if (build !== null && (build.length === 0 || !validSemverParts(build, false))) return false;
  const dashIndex = versionAndPrerelease.indexOf('-');
  const core = dashIndex === -1 ? versionAndPrerelease : versionAndPrerelease.slice(0, dashIndex);
  const prerelease = dashIndex === -1 ? undefined : versionAndPrerelease.slice(dashIndex + 1);
  const coreParts = core.split('.');
  return (
    coreParts.length === 3 &&
    coreParts.every((part) => RE_DECIMAL.test(part)) &&
    (prerelease === undefined || (prerelease.length > 0 && validSemverParts(prerelease, true)))
  );
}

function validSemverParts(value: string, rejectLeadingZero: boolean): boolean {
  return value
    .split('.')
    .every(
      (part) =>
        RE_SEMVER_IDENTIFIER.test(part) &&
        (!rejectLeadingZero || !RE_NUMERIC_IDENTIFIER.test(part) || RE_DECIMAL.test(part)),
    );
}

function isValidVersionRange(value: string): boolean {
  if (value.length === 0 || value.trim() !== value) return false;
  return value.split(' ').every((part) => {
    const operator = ['>=', '<=', '>', '<', '='].find((candidate) => part.startsWith(candidate));
    return operator !== undefined && isValidSemver(part.slice(operator.length));
  });
}

function assertSignedEnvelopeValue(value: unknown, label: string): asserts value is JsonValue {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError(`${label} numbers must be safe integers`);
    return;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertSignedEnvelopeValue(entry, `${label}[${index}]`);
    }
    return;
  }
  if (!isRecord(value)) throw new TypeError(`${label} must contain only JSON values`);
  for (const [key, entry] of Object.entries(value)) {
    assertSignedEnvelopeValue(entry, `${label}.${key}`);
  }
}
