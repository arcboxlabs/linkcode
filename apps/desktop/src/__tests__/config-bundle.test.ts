import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBrandIdentityArtifact } from '@linkcode/common/config';
import { keysLength } from 'foxts/property-count';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGeneratedConfigBundle, stageConfigBundle } from '../../scripts/config-bundle.mts';
import { assertStagedConfigMatchesGenerated } from '../../scripts/package-config.mts';
import {
  electronBuilderBrandConfig,
  serializeElectronBuilderBrandConfig,
} from '../build/electron-builder-brand';

const RE_REQUIRED_ABSENT =
  /LINKCODE_REQUIRE_CONFIG_BUNDLE=1 but apps\/desktop\/generated has no bundle/;
const RE_AMBIENT_IDENTITY = /MAIN_VITE_BRAND_IDENTITY must not be set/;
const RE_BRAND_ARTIFACT_MISMATCH = /brand artifacts do not match the config bundle/;
const RE_BUILDER_MISMATCH = /electron-builder brand config does not match/;
const RE_INCOMPLETE = /must contain exactly/;
const RE_IMMUTABLE = /immutable/;
const RE_REBUILD = /rebuild before packaging/;
const RE_WRONG_PLATFORM = /targets ios, expected desktop/;
const RE_FIXTURE_KEY = /conformance fixture key/;
const RE_ENABLED_TOGETHER = /enabled together/;
const SAFE_EMERGENCY_PUBLIC_KEY = 'I-ZZtxm_RMtR2fMqJtiENzX13BIMmqE8X9lDWQ-bg4c';
const FIXTURE_PUBLIC_KEYS = [
  '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
  'PUAXw-hDiVqStwqnTRt-vJyYLM8uxJaMwM1V8Sr0Zgw',
  '_FHNjmIYoaONpH7QAjDwWAgW7RO6MwOsXeuRFUiQgCU',
] as const;

vi.mock('electron', () => ({
  app: {
    commandLine: { getSwitchValue: () => '', hasSwitch: () => false },
    getLocale: () => 'en-US',
    getPath: () => '/unused',
    getVersion: () => '2.4.0',
    isPackaged: false,
  },
  dialog: { showErrorBox: vi.fn() },
}));

const FIXTURES = join(
  import.meta.dirname,
  '../../../../packages/foundation/common/src/config/__fixtures__',
);
const desktopFixture = readFileSync(join(FIXTURES, 'build-bundle-v1.json'), 'utf8');
const iosFixture = readFileSync(join(FIXTURES, 'build-bundle-v1-ios.json'), 'utf8');
const brandIdentityFixture = readFileSync(join(FIXTURES, 'brand-identity-v1.json'), 'utf8');
const brandBuilderFixture = serializeElectronBuilderBrandConfig(
  electronBuilderBrandConfig(parseBrandIdentityArtifact(JSON.parse(brandIdentityFixture))),
);
const brandIconFixture = Buffer.from('test brand icon');

const temporaryDirectories: string[] = [];

function isBrandedBundle(bundleText: string | undefined): boolean {
  if (bundleText === undefined) return false;
  try {
    return (JSON.parse(bundleText) as { brandId?: unknown }).brandId !== 'linkcode';
  } catch {
    return false;
  }
}

async function makeDesktopDir(
  bundleText?: string,
  brandArtifacts = isBrandedBundle(bundleText),
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'config-bundle-'));
  temporaryDirectories.push(dir);
  if (bundleText !== undefined) {
    mkdirSync(join(dir, 'generated'), { recursive: true });
    writeFileSync(join(dir, 'generated/config-build-bundle.json'), bundleText);
  }
  if (brandArtifacts) {
    mkdirSync(join(dir, 'generated/brand-assets'), { recursive: true });
    writeFileSync(join(dir, 'generated/brand-identity.json'), brandIdentityFixture);
    writeFileSync(join(dir, 'generated/electron-builder.brand.json'), brandBuilderFixture);
    writeFileSync(join(dir, 'generated/brand-assets/icon.png'), brandIconFixture);
  }
  return dir;
}

function desktopBundle(overrides: Record<string, unknown>): string {
  const fixture = JSON.parse(desktopFixture) as {
    keyrings: Record<string, unknown>;
  };
  return JSON.stringify({
    ...fixture,
    keyrings: {
      ...fixture.keyrings,
      emergency: { 'release-emergency': SAFE_EMERGENCY_PUBLIC_KEY },
    },
    ...overrides,
  });
}

const validDesktopFixture = desktopBundle({});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('loadGeneratedConfigBundle', () => {
  it('returns null when no bundle is rendered and none is required', async () => {
    const dir = await makeDesktopDir();
    expect(loadGeneratedConfigBundle(dir, {})).toBeNull();
  });

  it('rejects ambient brand identity even without generated output', async () => {
    const dir = await makeDesktopDir();
    expect(() =>
      loadGeneratedConfigBundle(dir, { MAIN_VITE_BRAND_IDENTITY: '{"brandId":"fake"}' }),
    ).toThrow(RE_AMBIENT_IDENTITY);
  });

  it('fails when LINKCODE_REQUIRE_CONFIG_BUNDLE=1 and no bundle exists', async () => {
    const dir = await makeDesktopDir();
    expect(() => loadGeneratedConfigBundle(dir, { LINKCODE_REQUIRE_CONFIG_BUNDLE: '1' })).toThrow(
      RE_REQUIRED_ABSENT,
    );
  });

  it('rejects an ambient MAIN_VITE_CONFIG_BOOTSTRAP when a bundle exists', async () => {
    const dir = await makeDesktopDir(desktopFixture);
    expect(() =>
      loadGeneratedConfigBundle(dir, { MAIN_VITE_CONFIG_BOOTSTRAP: '{"defaults":{}}' }),
    ).toThrow(RE_IMMUTABLE);
  });

  it('rejects an ambient MAIN_VITE_AGENT_RESTRICTIONS when a bundle exists', async () => {
    const dir = await makeDesktopDir(desktopFixture);
    expect(() =>
      loadGeneratedConfigBundle(dir, { MAIN_VITE_AGENT_RESTRICTIONS: '{"agents":["pi"]}' }),
    ).toThrow(RE_IMMUTABLE);
  });

  it('omits agentRestrictionsJson when the bundle declares neither agents nor services', async () => {
    const dir = await makeDesktopDir(validDesktopFixture);
    const generated = loadGeneratedConfigBundle(dir, {});
    expect(generated?.agentRestrictionsJson).toBeUndefined();
  });

  it('derives agentRestrictionsJson from the bundle agents/services fields', async () => {
    const dir = await makeDesktopDir(
      desktopBundle({ agents: ['pi'], services: ['linkcode-gateway'] }),
    );
    const generated = loadGeneratedConfigBundle(dir, {});
    expect(generated?.agentRestrictionsJson).toBe(
      JSON.stringify({ agents: ['pi'], services: ['linkcode-gateway'] }),
    );
  });

  it('fails closed on malformed JSON', async () => {
    const dir = await makeDesktopDir('{not json');
    expect(() => loadGeneratedConfigBundle(dir, {})).toThrow();
  });

  it('fails closed on an unknown top-level field', async () => {
    const tampered = JSON.stringify({
      ...(JSON.parse(validDesktopFixture) as Record<string, unknown>),
      extraField: true,
    });
    const dir = await makeDesktopDir(tampered);
    expect(() => loadGeneratedConfigBundle(dir, {})).toThrow();
  });

  it('rejects a bundle rendered for a different platform', async () => {
    const dir = await makeDesktopDir(iosFixture);
    expect(() => loadGeneratedConfigBundle(dir, {})).toThrow(RE_WRONG_PLATFORM);
  });

  it('accepts a complete emergency bootstrap and allows the fixture key in the normal keyring', async () => {
    const dir = await makeDesktopDir(validDesktopFixture);
    expect(() =>
      loadGeneratedConfigBundle(dir, { LINKCODE_REQUIRE_CONFIG_BUNDLE: '1' }),
    ).not.toThrow();
  });

  it.each(FIXTURE_PUBLIC_KEYS)(
    'always rejects RFC 8032 fixture key %s in the emergency keyring',
    async (fixturePublicKey) => {
      const fixture = JSON.parse(desktopFixture) as { keyrings: Record<string, unknown> };
      const dir = await makeDesktopDir(
        desktopBundle({
          keyrings: { ...fixture.keyrings, emergency: { fixture: fixturePublicKey } },
        }),
      );
      expect(() => loadGeneratedConfigBundle(dir, {})).toThrow(RE_FIXTURE_KEY);
    },
  );

  it('allows an absent emergency bootstrap in required release bundles', async () => {
    const fixture = JSON.parse(desktopFixture) as {
      endpoints: Record<string, unknown>;
      keyrings: Record<string, unknown>;
    };
    const incomplete = desktopBundle({
      endpoints: { ...fixture.endpoints, emergency: null },
      keyrings: { ...fixture.keyrings, emergency: {} },
    });
    const optionalDir = await makeDesktopDir(incomplete);
    expect(() => loadGeneratedConfigBundle(optionalDir, {})).not.toThrow();
    expect(() =>
      loadGeneratedConfigBundle(optionalDir, { LINKCODE_REQUIRE_CONFIG_BUNDLE: '1' }),
    ).not.toThrow();
  });

  it.each([
    [
      'missing emergency endpoint',
      { endpoints: { ...JSON.parse(desktopFixture).endpoints, emergency: null } },
    ],
    [
      'empty emergency keyring',
      { keyrings: { ...JSON.parse(desktopFixture).keyrings, emergency: {} } },
    ],
  ])(
    'rejects a mismatched %s even when the generated bundle is optional',
    async (_name, overrides) => {
      const dir = await makeDesktopDir(desktopBundle(overrides));
      expect(() => loadGeneratedConfigBundle(dir, {})).toThrow(RE_ENABLED_TOGETHER);
    },
  );

  it('rejects a non-default bundle without the complete brand artifact set', async () => {
    const dir = await makeDesktopDir(validDesktopFixture, false);
    expect(() => loadGeneratedConfigBundle(dir, {})).toThrow(RE_INCOMPLETE);
    expect(() => assertStagedConfigMatchesGenerated(dir)).toThrow(RE_BRAND_ARTIFACT_MISMATCH);
  });

  it('rejects a builder overlay that does not match the rendered identity', async () => {
    const dir = await makeDesktopDir(validDesktopFixture);
    writeFileSync(join(dir, 'generated/electron-builder.brand.json'), '{}\n');
    expect(() => loadGeneratedConfigBundle(dir, {})).toThrow(RE_BUILDER_MISMATCH);
  });

  it('derives a bootstrap that the runtime parser accepts, with exact source bytes', async () => {
    const dir = await makeDesktopDir(validDesktopFixture);
    const generated = loadGeneratedConfigBundle(dir, {});
    expect(generated).not.toBeNull();
    expect(generated?.bundleText).toBe(validDesktopFixture);

    const { parseBootstrap } = await import('../main/config');
    const bootstrap = parseBootstrap(generated?.bootstrapJson);
    const fixture = JSON.parse(validDesktopFixture) as {
      brandId: string;
      channel: string;
      endpoints: { normal: string | null; emergency: string | null; telemetry: string | null };
      keyrings: { normal: Record<string, string>; emergency: Record<string, string> };
    };
    expect(bootstrap.brandId).toBe(fixture.brandId);
    expect(bootstrap.channel).toBe(fixture.channel);
    expect(bootstrap.endpoint).toBe(fixture.endpoints.normal);
    expect(bootstrap.emergencyEndpoint).toBe(fixture.endpoints.emergency);
    expect(bootstrap.telemetryEndpoint).toBe(fixture.endpoints.telemetry);
    expect(bootstrap.publicKeys).toEqual(fixture.keyrings.normal);
    expect(bootstrap.emergencyPublicKeys).toEqual(fixture.keyrings.emergency);
    expect(keysLength(bootstrap.defaults)).toBeGreaterThan(0);
  });

  it('never carries private key material into the bootstrap', async () => {
    const dir = await makeDesktopDir(validDesktopFixture);
    const generated = loadGeneratedConfigBundle(dir, {});
    expect(generated?.bootstrapJson.toLowerCase()).not.toContain('private');
    expect(generated?.bootstrapJson.toLowerCase()).not.toContain('secret');
  });
});

describe('stageConfigBundle', () => {
  it('stages the exact source bytes into out/config', async () => {
    const dir = await makeDesktopDir(validDesktopFixture);
    const generated = loadGeneratedConfigBundle(dir, {});
    stageConfigBundle(dir, generated);
    expect(readFileSync(join(dir, 'out/config/build-bundle.json'), 'utf8')).toBe(
      validDesktopFixture,
    );
    expect(readFileSync(join(dir, 'out/config/brand-identity.json'), 'utf8')).toBe(
      brandIdentityFixture,
    );
    expect(readFileSync(join(dir, 'out/config/electron-builder.brand.json'), 'utf8')).toBe(
      brandBuilderFixture,
    );
    expect(readFileSync(join(dir, 'out/config/brand-assets/icon.png'))).toEqual(brandIconFixture);
    expect(assertStagedConfigMatchesGenerated(dir)).toBe(true);
  });

  it('rejects packaging after generated artifacts change without a rebuild', async () => {
    const dir = await makeDesktopDir(validDesktopFixture);
    const generated = loadGeneratedConfigBundle(dir, {});
    stageConfigBundle(dir, generated);
    writeFileSync(join(dir, 'generated/brand-identity.json'), brandIdentityFixture.trim());
    expect(() => assertStagedConfigMatchesGenerated(dir)).toThrow(RE_REBUILD);
  });

  it('removes a stale staged copy when no bundle is rendered', async () => {
    const dir = await makeDesktopDir();
    mkdirSync(join(dir, 'out/config'), { recursive: true });
    writeFileSync(join(dir, 'out/config/build-bundle.json'), 'stale');
    stageConfigBundle(dir, null);
    expect(existsSync(join(dir, 'out/config'))).toBe(false);
    expect(assertStagedConfigMatchesGenerated(dir)).toBe(false);
  });
});
