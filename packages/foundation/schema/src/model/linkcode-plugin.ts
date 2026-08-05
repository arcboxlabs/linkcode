import { z } from 'zod';
import { PluginAssetRequirementSchema, PluginAuthorSchema, PluginLinksSchema } from './plugin';

const ID_SEGMENT_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
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
  components: z.array(z.object(linkCodePluginSkillFields)).min(1),
  /** Trusted managed-tool requirements; URLs and exact asset versions remain host-owned. */
  assets: z.array(PluginAssetRequirementSchema),
} as const;

function rejectDuplicateComponents(
  manifest: { components: LinkCodePluginSkill[] },
  ctx: z.RefinementCtx,
): void {
  const names = new Set<string>();
  for (const component of manifest.components) {
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

/**
 * Agent-independent package manifest. Provider-specific discovery remains on `PluginSchema`; this
 * contract is the source format LinkCode installs once and projects into supported agents.
 */
export const LinkCodePluginManifestSchema = z
  .strictObject({
    ...linkCodePluginManifestFields,
    components: z.array(LinkCodePluginSkillSchema).min(1),
  })
  .superRefine(rejectDuplicateComponents);
export type LinkCodePluginManifest = z.infer<typeof LinkCodePluginManifestSchema>;

/** Forward-compatible marketplace reader for additive fields within manifest version 1. */
const LinkCodePluginManifestReaderSchema = z
  .object(linkCodePluginManifestFields)
  .superRefine(rejectDuplicateComponents);

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
