import { z } from 'zod';
import { PluginAssetRequirementSchema, PluginAuthorSchema, PluginLinksSchema } from './plugin';

const ID_SEGMENT_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
// MCP server names become provider-config keys, where `.` is a path separator that can reshape or
// collide with another entry.
const MCP_SERVER_NAME_RE = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const PACKAGE_PATH_SEGMENT_RE = /^[0-9A-Z][\w.-]*$/i;
const WINDOWS_RESERVED_SEGMENT_RE = /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\.|$)/i;
const NUMERIC_IDENTIFIER_RE = /^\d+$/;
const WHITESPACE_RE = /\s+/;
const MAX_ID_SEGMENT_LENGTH = 64;
const SEMVER_RE =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?(?:\+[0-9A-Z-]+(?:\.[0-9A-Z-]+)*)?$/i;
const SRI_TOKEN_RE = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/;
const SRI_DIGEST_LENGTHS: Readonly<Record<string, number>> = {
  sha256: 32,
  sha384: 48,
  sha512: 64,
};

function isSafeIdSegment(value: string): boolean {
  return (
    value.length <= MAX_ID_SEGMENT_LENGTH &&
    ID_SEGMENT_RE.test(value) &&
    !WINDOWS_RESERVED_SEGMENT_RE.test(value)
  );
}

function isSemver(value: string): boolean {
  if (!SEMVER_RE.test(value)) return false;
  const buildStart = value.indexOf('+');
  const versionWithoutBuild = buildStart === -1 ? value : value.slice(0, buildStart);
  const prereleaseStart = versionWithoutBuild.indexOf('-');
  if (prereleaseStart === -1) return true;
  const prerelease = versionWithoutBuild.slice(prereleaseStart + 1);
  return prerelease
    .split('.')
    .every(
      (identifier) =>
        !NUMERIC_IDENTIFIER_RE.test(identifier) || identifier === '0' || identifier[0] !== '0',
    );
}

function isSri(value: string): boolean {
  if (value.length === 0 || value.trim() !== value) return false;
  return value.split(WHITESPACE_RE).every((token) => {
    const match = SRI_TOKEN_RE.exec(token);
    if (!match) return false;
    const [, algorithm, encoded] = match;
    try {
      const decoded = atob(encoded);
      return decoded.length === SRI_DIGEST_LENGTHS[algorithm] && btoa(decoded) === encoded;
    } catch {
      return false;
    }
  });
}

/** Stable LinkCode marketplace identity, independent of every agent provider. */
export const LinkCodePluginIdSchema = z.string().refine((id) => {
  const segments = id.split('/');
  return segments.length === 2 && segments.every((segment) => isSafeIdSegment(segment));
}, 'Expected a safe lowercase publisher/name plugin id');
export type LinkCodePluginId = z.infer<typeof LinkCodePluginIdSchema>;

/** Stable configured-marketplace identity persisted in local installation records. */
export const LinkCodeMarketplaceIdSchema = z
  .string()
  .refine(isSafeIdSegment, 'Expected a safe lowercase marketplace id');
export type LinkCodeMarketplaceId = z.infer<typeof LinkCodeMarketplaceIdSchema>;

/** Exact package version. Compatibility ranges belong on requirements, never release identity. */
export const LinkCodePluginVersionSchema = z.string().refine(isSemver, 'Expected a semver version');
export type LinkCodePluginVersion = z.infer<typeof LinkCodePluginVersionSchema>;

/** Forward-slash path inside a verified plugin archive. */
export const LinkCodePluginPackagePathSchema = z
  .string()
  .min(1)
  .refine(
    (path) => {
      if (path[0] === '/' || path.includes('\\')) return false;
      return path
        .split('/')
        .every(
          (segment) =>
            PACKAGE_PATH_SEGMENT_RE.test(segment) &&
            !segment.endsWith('.') &&
            !WINDOWS_RESERVED_SEGMENT_RE.test(segment),
        );
    },
    { error: 'Expected a normalized relative package path' },
  );
export type LinkCodePluginPackagePath = z.infer<typeof LinkCodePluginPackagePathSchema>;

const linkCodePluginSkillFields = {
  kind: z.literal('skill'),
  name: z.string().refine(isSafeIdSegment, 'Expected a safe lowercase skill name'),
  description: z.string().optional(),
  /** Package-relative SKILL.md entry point. */
  entry: LinkCodePluginPackagePathSchema.refine(
    (path) => path.split('/').at(-1) === 'SKILL.md',
    'Expected a package path ending in SKILL.md',
  ),
} as const;

/** First portable LinkCode component: an Agent Skill package that adapters can materialize. */
export const LinkCodePluginSkillSchema = z.strictObject(linkCodePluginSkillFields);
export type LinkCodePluginSkill = z.infer<typeof LinkCodePluginSkillSchema>;

/** Setting value types a manifest may declare; the host renders and stores only these. */
export const LinkCodePluginSettingTypeSchema = z.enum([
  'string',
  'password',
  'enum',
  'boolean',
  'number',
]);
export type LinkCodePluginSettingType = z.infer<typeof LinkCodePluginSettingTypeSchema>;

/**
 * One declared configuration input. `secret: true` routes the value to the vault (never
 * `config.json`, never returned unmasked); the rest mirror a constrained JSON-Schema field so the
 * host can render a form without executing plugin code.
 */
export const LinkCodePluginSettingFieldSchema = z
  .strictObject({
    type: LinkCodePluginSettingTypeSchema,
    label: z.string().min(1).optional(),
    description: z.string().optional(),
    secret: z.boolean().optional(),
    required: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    enum: z.array(z.string().min(1)).optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'enum' && (!field.enum || field.enum.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        message: 'An enum setting must list at least one option',
        path: ['enum'],
      });
    }
    if (field.type !== 'enum' && field.enum !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'enum options are only valid on an enum setting',
        path: ['enum'],
      });
    }
    if (field.type === 'password' && field.secret !== true) {
      ctx.addIssue({
        code: 'custom',
        message: 'A password setting must be secret',
        path: ['secret'],
      });
    }
    if (field.default !== undefined) {
      // valid-typeof compares against literals only, so spell the expected type out per branch.
      const defaultMatchesType =
        field.type === 'number'
          ? typeof field.default === 'number'
          : field.type === 'boolean'
            ? typeof field.default === 'boolean'
            : typeof field.default === 'string';
      if (!defaultMatchesType) {
        ctx.addIssue({
          code: 'custom',
          message: `A ${field.type} setting's default has the wrong JSON type`,
          path: ['default'],
        });
      } else if (
        field.type === 'enum' &&
        field.enum !== undefined &&
        typeof field.default === 'string' &&
        !field.enum.includes(field.default)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: "An enum setting's default must be one of its options",
          path: ['default'],
        });
      }
    }
  });
export type LinkCodePluginSettingField = z.infer<typeof LinkCodePluginSettingFieldSchema>;

/** Runtime check mirroring the manifest schema: does a stored/patched value fit the declared field?
 * The daemon enforces this on writes and on upgrade reconciliation; the UI is never the authority. */
export function isValidPluginSettingValue(
  field: LinkCodePluginSettingField,
  value: unknown,
): value is string | number | boolean {
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'enum':
      return typeof value === 'string' && field.enum?.includes(value) === true;
    default:
      return typeof value === 'string';
  }
}

export const LinkCodePluginSettingsSchema = z.record(
  z.string().refine(isSafeIdSegment, 'Expected a safe lowercase setting id'),
  LinkCodePluginSettingFieldSchema,
);
export type LinkCodePluginSettings = z.infer<typeof LinkCodePluginSettingsSchema>;

const linkCodePluginMcpServerFields = {
  kind: z.literal('mcp-server'),
  name: z
    .string()
    .refine(
      (value) => value.length <= MAX_ID_SEGMENT_LENGTH && MCP_SERVER_NAME_RE.test(value),
      'Expected a safe lowercase server name (letters, digits, _ or -; no dot)',
    ),
  description: z.string().optional(),
  command: z.string().min(1),
  /** Package-relative entry point. When present, the host resolves it under the installed plugin
   * root and prepends it to args, so manifests never need to contain machine-specific paths. */
  entry: LinkCodePluginPackagePathSchema.optional(),
  args: z.array(z.string().min(1)).optional(),
  /** Maps env-var name to a setting field id; the host resolves stored setting values into env at
   * session start. Keys not declared here are not injected. */
  env: z.record(z.string().min(1), z.string().min(1)).optional(),
} as const;

/** A plugin-shipped MCP server the host spawns per session, fed by the manifest's declared settings. */
export const LinkCodePluginMcpServerComponentSchema = z.strictObject(linkCodePluginMcpServerFields);
export type LinkCodePluginMcpServerComponent = z.infer<
  typeof LinkCodePluginMcpServerComponentSchema
>;

/** A manifest component — a skill or an MCP server the host materializes. */
export const LinkCodePluginComponentSchema = z.union([
  LinkCodePluginSkillSchema,
  LinkCodePluginMcpServerComponentSchema,
]);
export type LinkCodePluginComponent = z.infer<typeof LinkCodePluginComponentSchema>;

/** Non-strict reader union: strips unknown component keys so a newer peer's additive field does
 * not hide a compatible release from an older reader. */
const LinkCodePluginComponentReaderSchema = z.union([
  z.object(linkCodePluginSkillFields),
  z.object(linkCodePluginMcpServerFields),
]);

const linkCodePluginManifestFields = {
  manifestVersion: z.literal(1),
  id: LinkCodePluginIdSchema,
  version: LinkCodePluginVersionSchema,
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  author: PluginAuthorSchema.optional(),
  category: z.string().min(1).optional(),
  keywords: z.array(z.string().min(1)),
  links: PluginLinksSchema.optional(),
  components: z.array(LinkCodePluginComponentReaderSchema).min(1),
  /** Declared configuration inputs the host renders and stores; an MCP-server component reads these. */
  settings: LinkCodePluginSettingsSchema.optional(),
  /** Trusted managed-tool requirements; URLs and exact asset versions remain host-owned. */
  assets: z.array(PluginAssetRequirementSchema),
} as const;

function rejectDuplicateComponents(
  manifest: { components: LinkCodePluginComponent[] },
  ctx: z.RefinementCtx,
): void {
  const names = new Set<string>();
  for (let i = 0, len = manifest.components.length; i < len; i++) {
    const component = manifest.components[i];
    const key = `${component.kind}:${component.name}`;
    if (names.has(key)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate plugin component: ${key}`,
        path: ['components'],
      });
    }
    names.add(key);
  }
}

/** Rejects an MCP-server component whose `env` maps to a setting id the manifest never declares. */
function rejectUnresolvedEnvBindings(
  manifest: { components: LinkCodePluginComponent[]; settings?: LinkCodePluginSettings },
  ctx: z.RefinementCtx,
): void {
  const declared = new Set(manifest.settings ? Object.keys(manifest.settings) : []);
  for (let i = 0, len = manifest.components.length; i < len; i++) {
    const component = manifest.components[i];
    if (component.kind !== 'mcp-server' || !component.env) continue;
    const index = i;
    const envEntries = Object.entries(component.env);
    for (let j = 0, envCount = envEntries.length; j < envCount; j++) {
      const [envName, settingId] = envEntries[j];
      if (!declared.has(settingId)) {
        ctx.addIssue({
          code: 'custom',
          message: `env ${envName} references undeclared setting "${settingId}"`,
          path: ['components', index, 'env', envName],
        });
      }
    }
  }
}

/**
 * Agent-independent package manifest. Provider-specific discovery remains on `PluginSchema`; this
 * contract is the source format LinkCode installs once and projects into supported agents.
 */
export const LinkCodePluginManifestSchema = z
  .strictObject({
    ...linkCodePluginManifestFields,
    components: z.array(LinkCodePluginComponentSchema).min(1),
  })
  .superRefine(rejectDuplicateComponents)
  .superRefine(rejectUnresolvedEnvBindings);
export type LinkCodePluginManifest = z.infer<typeof LinkCodePluginManifestSchema>;

/** Forward-compatible marketplace reader for additive fields within manifest version 1. */
export const LinkCodePluginManifestReaderSchema = z
  .object(linkCodePluginManifestFields)
  .superRefine(rejectDuplicateComponents)
  .superRefine(rejectUnresolvedEnvBindings);

export const LinkCodePluginArchiveFormatSchema = z.enum(['tgz', 'zip']);
export type LinkCodePluginArchiveFormat = z.infer<typeof LinkCodePluginArchiveFormatSchema>;

/** SRI digest of immutable package bytes; retained after install for audit and re-verification. */
export const LinkCodePluginIntegritySchema = z
  .string()
  .refine(isSri, 'Expected canonical sha256, sha384, or sha512 SRI integrity');
export type LinkCodePluginIntegrity = z.infer<typeof LinkCodePluginIntegritySchema>;

/** Immutable package bytes advertised by a marketplace release. */
export const LinkCodePluginArtifactSchema = z.object({
  /**
   * Ordered HTTPS or marketplace-relative mirrors of the same integrity-pinned bytes. Relative
   * URLs resolve against the marketplace index document URL per RFC 3986.
   */
  urls: z.array(z.union([z.url({ protocol: /^https$/ }), LinkCodePluginPackagePathSchema])).min(1),
  integrity: LinkCodePluginIntegritySchema,
  size: z.number().int().positive().optional(),
  format: LinkCodePluginArchiveFormatSchema,
});
export type LinkCodePluginArtifact = z.infer<typeof LinkCodePluginArtifactSchema>;

/** One immutable marketplace release: catalog metadata plus its verified package artifact. */
export const LinkCodePluginReleaseSchema = z.object({
  manifest: LinkCodePluginManifestReaderSchema,
  artifact: LinkCodePluginArtifactSchema,
  publishedAt: z.iso.datetime({ offset: true }).optional(),
});
export type LinkCodePluginRelease = z.infer<typeof LinkCodePluginReleaseSchema>;

/** Only `mcp-server` components are projected into agents today: a release without one (skill-only,
 * or gated on manifest `assets` nothing consumes yet) must not present as installable — installing
 * it would report success while providing no functionality. Filtered at the catalog/install
 * boundary until skill/asset projection ships. */
export function isProjectablePluginRelease(release: {
  manifest: { components: ReadonlyArray<{ kind: string }>; assets: readonly unknown[] };
}): boolean {
  return (
    release.manifest.components.some((component) => component.kind === 'mcp-server') &&
    release.manifest.assets.length === 0
  );
}

/** Mutable local Store state, deliberately separate from manifest and marketplace release data. */
export const InstalledLinkCodePluginSchema = z.object({
  id: LinkCodePluginIdSchema,
  version: LinkCodePluginVersionSchema,
  /** Stable id of the configured marketplace that supplied this release. */
  marketplaceId: LinkCodeMarketplaceIdSchema,
  /** Artifact digest actually verified before this package was published into the Store. */
  integrity: LinkCodePluginIntegritySchema,
  enabled: z.boolean(),
  /** Absolute package root in the daemon's local plugin Store. */
  path: z.string().min(1),
});
export type InstalledLinkCodePlugin = z.infer<typeof InstalledLinkCodePluginSchema>;
