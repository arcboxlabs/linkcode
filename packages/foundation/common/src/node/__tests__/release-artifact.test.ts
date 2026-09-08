import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeJson,
  configBuildBundleDefaults,
  parseBrandIdentityArtifact,
  parseConfigBuildBundle,
} from '../../config';
import identityFixture from '../../config/__fixtures__/brand-identity-v1.json';
import bundleFixture from '../../config/__fixtures__/build-bundle-v1.json';
import {
  assertStoreCompliance,
  createReleaseArtifactProvenance,
  verifyReleaseArtifactProvenance,
  writeReleaseArtifactProvenance,
} from '../release-artifact';

const bundle = parseConfigBuildBundle(structuredClone(bundleFixture));
const identity = parseBrandIdentityArtifact(structuredClone(identityFixture));
const disclosedFeatures = [
  'feature.aiAssist',
  'feature.newEditor',
  'modules.messaging.enabled',
  'modules.terminal.enabled',
  'modules.workspace.enabled',
];
const compliance = {
  checklist: {
    configurableFeaturesDisclosed: true,
    dataPracticesReviewed: true,
    noExecutableCode: true,
    permissionsReviewed: true,
    storeMetadataReviewed: true,
  },
  disclosedFeatures,
};
const releaseManifest = {
  brandId: bundle.brandId,
  channel: bundle.channel,
  configRevisionId: bundle.provenance.configRevisionId,
  expectedSnapshotSha256: bundle.snapshot.sha256,
  platform: bundle.platform,
  publisherGitSha: 'a'.repeat(40),
  sourceGitSha: bundle.provenance.sourceGitSha,
};
const RE_SHA256 = /^[0-9a-f]{64}$/;
const RE_EXISTS = /EEXIST/;
const clientGitSha = 'f'.repeat(40);
const deliveryDescriptorBytes = new TextEncoder().encode('{"brand":"acme"}');
const expectedDeliveryDescriptorSha256 = createHash('sha256')
  .update(deliveryDescriptorBytes)
  .digest('hex');

describe('release artifact provenance', () => {
  it('binds each isolated artifact to the manifest, revision, and defaults digests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'release-artifact-'));
    await writeFile(join(root, 'installer.zip'), 'artifact');
    const provenance = await createReleaseArtifactProvenance({
      artifactPaths: ['installer.zip'],
      artifactRoot: root,
      brandIdentity: identity,
      brandManifestBytes: new TextEncoder().encode('brands: [acme]'),
      bundle,
      clientGitSha,
      compliance,
      deliveryDescriptorBytes,
      expectedDeliveryDescriptorSha256,
      releaseManifest,
      releaseManifestBytes: new TextEncoder().encode('{}'),
      signed: false,
    });
    expect(provenance).toMatchObject({
      brandId: 'acme',
      platform: 'desktop',
      signed: false,
    });
    expect(provenance.artifacts[0]).toMatchObject({
      configRevisionId: bundle.provenance.configRevisionId,
      path: 'installer.zip',
      sizeBytes: 8,
    });
    expect(provenance.artifacts[0]?.brandManifestSha256).toMatch(RE_SHA256);
    expect(provenance.artifacts[0]?.defaultsSha256).toMatch(RE_SHA256);
    expect(provenance.deliveryDescriptorSha256).toBe(expectedDeliveryDescriptorSha256);
    expect(provenance.artifacts[0]?.brandManifestSha256).toBe(
      createHash('sha256').update('brands: [acme]').digest('hex'),
    );
    expect(provenance.artifacts[0]?.defaultsSha256).toBe(
      createHash('sha256')
        .update(canonicalizeJson(configBuildBundleDefaults(bundle)))
        .digest('hex'),
    );
  });

  it('rejects undisclosed feature keys and executable-code surfaces', () => {
    expect(() => assertStoreCompliance(bundle, { ...compliance, disclosedFeatures: [] })).toThrow(
      'must exactly match',
    );
    const executable = structuredClone(bundleFixture);
    const snapshot = JSON.parse(Buffer.from(executable.snapshot.base64Url, 'base64url').toString());
    snapshot.values['content.home.banner'].url = 'https://example.invalid/payload.wasm';
    const bytes = Buffer.from(canonicalizeJson(snapshot));
    executable.snapshot.base64Url = bytes.toString('base64url');
    executable.snapshot.sha256 = createHash('sha256').update(bytes).digest('hex');
    executable.snapshot.sizeBytes = bytes.byteLength;
    expect(() => assertStoreCompliance(parseConfigBuildBundle(executable), compliance)).toThrow(
      'executable code',
    );

    const bypassCases = [
      ['content.pluginUrl', 'https://example.invalid/content', 'executable'],
      ['modules.wasmLoader', false, 'must exactly match'],
      ['content.scriptPath', '/content/banner', 'executable'],
      ['content.inline', '<div><script>alert(1)</script></div>', 'executable'],
      ['content.source', 'data:text/javascript,alert(1)', 'executable'],
    ] as const;
    for (let i = 0, len = bypassCases.length; i < len; i++) {
      const [key, value, expected] = bypassCases[i];
      const bypass = structuredClone(bundleFixture);
      const bypassSnapshot = JSON.parse(
        Buffer.from(bypass.snapshot.base64Url, 'base64url').toString(),
      );
      bypassSnapshot.values[key] = value;
      bypassSnapshot.applyModes[key] = 'hot';
      const bypassBytes = Buffer.from(canonicalizeJson(bypassSnapshot));
      bypass.snapshot.base64Url = bypassBytes.toString('base64url');
      bypass.snapshot.sha256 = createHash('sha256').update(bypassBytes).digest('hex');
      bypass.snapshot.sizeBytes = bypassBytes.byteLength;
      expect(() => assertStoreCompliance(parseConfigBuildBundle(bypass), compliance)).toThrow(
        expected,
      );
    }
  });

  it('requires the complete store-compliance checklist', () => {
    expect(() =>
      assertStoreCompliance(bundle, {
        checklist: { noExecutableCode: true },
        disclosedFeatures,
      }),
    ).toThrow('must contain exactly');
    expect(() =>
      assertStoreCompliance(bundle, {
        ...compliance,
        checklist: { ...compliance.checklist, permissionsReviewed: false },
      }),
    ).toThrow('permissionsReviewed must be true');
  });

  it('rejects a review-only configuration key outside the disclosure surface', () => {
    const review = structuredClone(bundleFixture);
    const snapshot = JSON.parse(Buffer.from(review.snapshot.base64Url, 'base64url').toString());
    snapshot.values['app.review.mode'] = true;
    snapshot.applyModes['app.review.mode'] = 'hot';
    const bytes = Buffer.from(canonicalizeJson(snapshot));
    review.snapshot.base64Url = bytes.toString('base64url');
    review.snapshot.sha256 = createHash('sha256').update(bytes).digest('hex');
    review.snapshot.sizeBytes = bytes.byteLength;
    expect(() => assertStoreCompliance(parseConfigBuildBundle(review), compliance)).toThrow(
      'is not a disclosed feature/module',
    );

    const camelCase = structuredClone(bundleFixture);
    const camelCaseSnapshot = JSON.parse(
      Buffer.from(camelCase.snapshot.base64Url, 'base64url').toString(),
    );
    camelCaseSnapshot.values['app.reviewMode'] = true;
    camelCaseSnapshot.applyModes['app.reviewMode'] = 'hot';
    const camelCaseBytes = Buffer.from(canonicalizeJson(camelCaseSnapshot));
    camelCase.snapshot.base64Url = camelCaseBytes.toString('base64url');
    camelCase.snapshot.sha256 = createHash('sha256').update(camelCaseBytes).digest('hex');
    camelCase.snapshot.sizeBytes = camelCaseBytes.byteLength;
    expect(() => assertStoreCompliance(parseConfigBuildBundle(camelCase), compliance)).toThrow(
      'is not a disclosed feature/module',
    );

    const lowercase = structuredClone(bundleFixture);
    const lowercaseSnapshot = JSON.parse(
      Buffer.from(lowercase.snapshot.base64Url, 'base64url').toString(),
    );
    lowercaseSnapshot.values['app.reviewmode'] = true;
    lowercaseSnapshot.applyModes['app.reviewmode'] = 'hot';
    const lowercaseBytes = Buffer.from(canonicalizeJson(lowercaseSnapshot));
    lowercase.snapshot.base64Url = lowercaseBytes.toString('base64url');
    lowercase.snapshot.sha256 = createHash('sha256').update(lowercaseBytes).digest('hex');
    lowercase.snapshot.sizeBytes = lowercaseBytes.byteLength;
    expect(() => assertStoreCompliance(parseConfigBuildBundle(lowercase), compliance)).toThrow(
      'is not a disclosed feature/module',
    );

    const hidden = structuredClone(bundleFixture);
    const hiddenSnapshot = JSON.parse(
      Buffer.from(hidden.snapshot.base64Url, 'base64url').toString(),
    );
    hiddenSnapshot.reviewMode = true;
    const hiddenBytes = Buffer.from(canonicalizeJson(hiddenSnapshot));
    hidden.snapshot.base64Url = hiddenBytes.toString('base64url');
    hidden.snapshot.sha256 = createHash('sha256').update(hiddenBytes).digest('hex');
    hidden.snapshot.sizeBytes = hiddenBytes.byteLength;
    expect(() => assertStoreCompliance(parseConfigBuildBundle(hidden), compliance)).toThrow(
      'is not a disclosed feature/module',
    );
  });

  it('rejects path traversal and mismatched release bindings without touching another brand', async () => {
    const root = await mkdtemp(join(tmpdir(), 'release-isolation-'));
    await writeFile(join(root, 'artifact'), 'acme');
    const otherEvidence = join(root, 'zenith.provenance.json');
    await writeFile(otherEvidence, 'untouched');
    const input = {
      artifactPaths: ['../artifact'],
      artifactRoot: root,
      brandIdentity: identity,
      brandManifestBytes: new Uint8Array(),
      bundle,
      clientGitSha,
      compliance,
      deliveryDescriptorBytes,
      expectedDeliveryDescriptorSha256,
      releaseManifest,
      releaseManifestBytes: new Uint8Array(),
      signed: false,
    };
    await expect(createReleaseArtifactProvenance(input)).rejects.toThrow(
      'escapes its isolated root',
    );
    await expect(
      createReleaseArtifactProvenance({
        ...input,
        artifactPaths: ['artifact'],
        releaseManifest: { ...releaseManifest, configRevisionId: 'wrong' },
      }),
    ).rejects.toThrow('configRevisionId does not match');
    expect(await readFile(otherEvidence, 'utf8')).toBe('untouched');
  });

  it('writes evidence once and never overwrites prior provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'release-evidence-'));
    const provenance = {
      artifacts: [],
      brandId: 'acme',
      channel: 'canary',
      clientGitSha,
      configSnapshotSha256: 'a'.repeat(64),
      deliveryDescriptorSha256: 'e'.repeat(64),
      platform: 'ios',
      publisherGitSha: 'b'.repeat(40),
      releaseArtifactProvenanceVersion: 1,
      releaseManifestSha256: 'c'.repeat(64),
      signed: false,
      sourceGitSha: 'd'.repeat(40),
    } as const;
    await writeReleaseArtifactProvenance('provenance.json', provenance, root);
    await expect(
      writeReleaseArtifactProvenance('provenance.json', provenance, root),
    ).rejects.toThrow(RE_EXISTS);
    await expect(writeReleaseArtifactProvenance('../other.json', provenance, root)).rejects.toThrow(
      'escapes its isolated root',
    );
  });

  it('re-hashes artifacts before upload and rejects target or byte drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'release-verify-'));
    await writeFile(join(root, 'installer.zip'), 'artifact');
    const provenance = await createReleaseArtifactProvenance({
      artifactPaths: ['installer.zip'],
      artifactRoot: root,
      brandIdentity: identity,
      brandManifestBytes: new TextEncoder().encode('brands: [acme]'),
      bundle,
      clientGitSha,
      compliance,
      deliveryDescriptorBytes,
      expectedDeliveryDescriptorSha256,
      releaseManifest,
      releaseManifestBytes: new TextEncoder().encode('{}'),
      signed: true,
    });
    await expect(
      verifyReleaseArtifactProvenance({
        artifactRoot: root,
        brandIdentity: identity,
        brandManifestBytes: new TextEncoder().encode('brands: [acme]'),
        brandId: bundle.brandId,
        bundle,
        clientGitSha,
        deliveryDescriptorBytes,
        expectedDeliveryDescriptorSha256,
        platform: bundle.platform,
        provenance,
        releaseManifest,
        releaseManifestBytes: new TextEncoder().encode('{}'),
        signed: true,
      }),
    ).resolves.toStrictEqual(provenance);
    await expect(
      verifyReleaseArtifactProvenance({
        artifactRoot: root,
        brandIdentity: identity,
        brandManifestBytes: new TextEncoder().encode('brands: [acme]'),
        brandId: bundle.brandId,
        bundle,
        clientGitSha,
        deliveryDescriptorBytes: new TextEncoder().encode('{"brand":"zenith"}'),
        expectedDeliveryDescriptorSha256,
        platform: bundle.platform,
        provenance,
        releaseManifest,
        releaseManifestBytes: new TextEncoder().encode('{}'),
        signed: true,
      }),
    ).rejects.toThrow('reviewed release matrix');
    await expect(
      verifyReleaseArtifactProvenance({
        artifactRoot: root,
        brandIdentity: identity,
        brandManifestBytes: new TextEncoder().encode('brands: [acme]'),
        brandId: 'zenith',
        bundle,
        clientGitSha,
        deliveryDescriptorBytes,
        expectedDeliveryDescriptorSha256,
        platform: bundle.platform,
        provenance,
        releaseManifest,
        releaseManifestBytes: new TextEncoder().encode('{}'),
        signed: true,
      }),
    ).rejects.toThrow('expected immutable release target');
    await expect(
      verifyReleaseArtifactProvenance({
        artifactRoot: root,
        brandIdentity: { ...identity, brandId: 'zenith' },
        brandManifestBytes: new TextEncoder().encode('brands: [acme]'),
        brandId: bundle.brandId,
        bundle,
        clientGitSha,
        deliveryDescriptorBytes,
        expectedDeliveryDescriptorSha256,
        platform: bundle.platform,
        provenance,
        releaseManifest,
        releaseManifestBytes: new TextEncoder().encode('{}'),
        signed: true,
      }),
    ).rejects.toThrow('brand identity targets zenith');
    await writeFile(join(root, 'installer.zip'), 'tampered');
    await expect(
      verifyReleaseArtifactProvenance({
        artifactRoot: root,
        brandIdentity: identity,
        brandManifestBytes: new TextEncoder().encode('brands: [acme]'),
        brandId: bundle.brandId,
        bundle,
        clientGitSha,
        deliveryDescriptorBytes,
        expectedDeliveryDescriptorSha256,
        platform: bundle.platform,
        provenance,
        releaseManifest,
        releaseManifestBytes: new TextEncoder().encode('{}'),
        signed: true,
      }),
    ).rejects.toThrow('bytes do not match');
  });
});
