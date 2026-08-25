import {
  assertMonotonicVersion,
  BrandIdSchema,
  ConfigChannelSchema,
  ConfigPlatformSchema,
  compareMonotonicVersions,
  Sha256Schema,
} from '@linkcode/schema/remote-config';
import type { AntiReplayDecision, AntiReplayState, ConfigTarget, EmergencyDocument } from './types';

export function decideAntiReplay(
  candidate: AntiReplayState,
  accepted: AntiReplayState | null,
): AntiReplayDecision {
  assertMonotonicVersion(candidate.version, 'candidate version');
  Sha256Schema.parse(candidate.payloadSha256);
  if (!accepted) return 'advance';
  assertMonotonicVersion(accepted.version, 'accepted version');
  Sha256Schema.parse(accepted.payloadSha256);
  const comparison = compareMonotonicVersions(candidate.version, accepted.version);
  if (comparison < 0) return 'replay';
  if (comparison > 0) return 'advance';
  return candidate.payloadSha256 === accepted.payloadSha256 ? 'idempotent' : 'equivocation';
}

export function targetMatches(
  document: Pick<ConfigTarget, 'brandId' | 'channel' | 'platform'>,
  target: ConfigTarget,
): boolean {
  return (
    document.brandId === target.brandId &&
    document.platform === target.platform &&
    document.channel === target.channel
  );
}

export function emergencyTargetMatches(
  document: Pick<EmergencyDocument, 'brandId' | 'platform'>,
  target: Pick<ConfigTarget, 'brandId' | 'platform'>,
): boolean {
  return document.brandId === target.brandId && document.platform === target.platform;
}

export function configPointerPath(target: ConfigTarget): string {
  assertTarget(target);
  return `/v1/${target.brandId}/${target.platform}/${target.channel}/latest.json`;
}

export function configSnapshotPath(target: ConfigTarget, sha256: string): string {
  assertTarget(target);
  Sha256Schema.parse(sha256);
  return `/v1/${target.brandId}/${target.platform}/${target.channel}/s/${sha256}.json`;
}

export function emergencyPath(target: Pick<ConfigTarget, 'brandId' | 'platform'>): string {
  BrandIdSchema.parse(target.brandId);
  ConfigPlatformSchema.parse(target.platform);
  return `/v1/${target.brandId}/${target.platform}/emergency.json`;
}

function assertTarget(target: ConfigTarget): void {
  BrandIdSchema.parse(target.brandId);
  ConfigPlatformSchema.parse(target.platform);
  ConfigChannelSchema.parse(target.channel);
}

export {
  assertConfigPointer,
  assertConfigSnapshot,
  assertEmergencyDocument,
  assertMonotonicVersion,
  canonicalizeJson,
  canonicalSignedPayload,
  canonicalSignedPayloadBytes,
  compareMonotonicVersions,
  isConfigKey,
  isRecord,
} from '@linkcode/schema/remote-config';
export {
  applyConfigPatch,
  applyMergePatch,
  conditionMatches,
  isUuidV4,
  localeMatches,
  murmur3X86_32,
  normalizeLocale,
  rolloutBucket,
  rolloutMatches,
} from './rules';
export {
  compareSemverStrings,
  isPrereleaseSemver,
  isValidSemver,
  isValidVersionRange,
  matchesVersionRange,
} from './semver';
