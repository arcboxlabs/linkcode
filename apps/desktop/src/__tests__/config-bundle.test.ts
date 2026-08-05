import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keysLength } from 'foxts/property-count';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGeneratedConfigBundle, stageConfigBundle } from '../../scripts/config-bundle.mts';

const RE_REQUIRED_ABSENT =
  /LINKCODE_REQUIRE_CONFIG_BUNDLE=1 but apps\/desktop\/generated has no bundle/;
const RE_IMMUTABLE = /immutable/;
const RE_WRONG_PLATFORM = /targets ios, expected desktop/;

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

const temporaryDirectories: string[] = [];

async function makeDesktopDir(bundleText?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'config-bundle-'));
  temporaryDirectories.push(dir);
  if (bundleText !== undefined) {
    mkdirSync(join(dir, 'generated'), { recursive: true });
    writeFileSync(join(dir, 'generated/config-build-bundle.json'), bundleText);
  }
  return dir;
}

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

  it('fails closed on malformed JSON', async () => {
    const dir = await makeDesktopDir('{not json');
    expect(() => loadGeneratedConfigBundle(dir, {})).toThrow();
  });

  it('fails closed on an unknown top-level field', async () => {
    const tampered = JSON.stringify({
      ...(JSON.parse(desktopFixture) as Record<string, unknown>),
      extraField: true,
    });
    const dir = await makeDesktopDir(tampered);
    expect(() => loadGeneratedConfigBundle(dir, {})).toThrow();
  });

  it('rejects a bundle rendered for a different platform', async () => {
    const dir = await makeDesktopDir(iosFixture);
    expect(() => loadGeneratedConfigBundle(dir, {})).toThrow(RE_WRONG_PLATFORM);
  });

  it('derives a bootstrap that the runtime parser accepts, with exact source bytes', async () => {
    const dir = await makeDesktopDir(desktopFixture);
    const generated = loadGeneratedConfigBundle(dir, {});
    expect(generated).not.toBeNull();
    expect(generated?.bundleText).toBe(desktopFixture);

    const { parseBootstrap } = await import('../main/config');
    const bootstrap = parseBootstrap(generated?.bootstrapJson);
    const fixture = JSON.parse(desktopFixture) as {
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
    const dir = await makeDesktopDir(desktopFixture);
    const generated = loadGeneratedConfigBundle(dir, {});
    expect(generated?.bootstrapJson.toLowerCase()).not.toContain('private');
    expect(generated?.bootstrapJson.toLowerCase()).not.toContain('secret');
  });
});

describe('stageConfigBundle', () => {
  it('stages the exact source bytes into out/config', async () => {
    const dir = await makeDesktopDir(desktopFixture);
    const generated = loadGeneratedConfigBundle(dir, {});
    stageConfigBundle(dir, generated);
    const staged = readFileSync(join(dir, 'out/config/build-bundle.json'), 'utf8');
    expect(staged).toBe(desktopFixture);
  });

  it('removes a stale staged copy when no bundle is rendered', async () => {
    const dir = await makeDesktopDir();
    mkdirSync(join(dir, 'out/config'), { recursive: true });
    writeFileSync(join(dir, 'out/config/build-bundle.json'), 'stale');
    stageConfigBundle(dir, null);
    expect(existsSync(join(dir, 'out/config'))).toBe(false);
  });
});
