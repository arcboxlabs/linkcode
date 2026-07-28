import { managedToolAssetId } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { descriptorFor, isClosureDescriptor } from '../catalog';
import { UnsupportedPlatformError } from '../errors';
import { resolveArtifact } from '../resolve';

const tectonic = descriptorFor(managedToolAssetId('tectonic'));
if (isClosureDescriptor(tectonic)) throw new Error('expected a binary descriptor');

describe('resolveArtifact', () => {
  it('passes baked artifacts through untouched', async () => {
    const artifact = await resolveArtifact(tectonic, '0.16.9', {
      platform: 'darwin-arm64',
    });
    expect(artifact.urls).toHaveLength(1);
    expect(artifact.urls[0]).toContain('aarch64-apple-darwin');
    expect(artifact.format).toBe('tgz');
    expect(artifact.member).toBe('tectonic');
    expect(artifact.size).toBeGreaterThan(0);
  });

  it('rejects platforms the asset does not describe', async () => {
    await expect(resolveArtifact(tectonic, '0.16.9', { platform: 'win32-arm64' })).rejects.toThrow(
      UnsupportedPlatformError,
    );
  });
});
