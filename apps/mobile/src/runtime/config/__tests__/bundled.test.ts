import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { bundledConfigFromModule } from '../bundled';
import sentinel from '../bundled.generated';

async function loadFixture(suffix: '' | '-android' | '-ios'): Promise<unknown> {
  const url = new URL(
    `../../../../../../packages/foundation/common/src/config/__fixtures__/build-bundle-v1${suffix}.json`,
    import.meta.url,
  );
  return JSON.parse(await readFile(url, 'utf8'));
}

describe('bundledConfigFromModule', () => {
  it('keeps the committed generated module as the development sentinel', () => {
    // The base file must stay { bundle: null }; renders only write platform-suffixed copies.
    expect(sentinel).toEqual({ bundle: null });
  });

  it('falls back to the development bootstrap only for the exact sentinel', () => {
    const { bootstrap, defaults, definitions } = bundledConfigFromModule({ bundle: null });
    expect(bootstrap.brandId).toBe('linkcode');
    expect(bootstrap.platform).toBeNull();
    expect(bootstrap.remoteBaseUrl).toBeNull();
    expect(bootstrap.telemetryEndpoint).toBeNull();
    expect(defaults).toEqual({});
    expect(definitions).toEqual({});
  });

  it('derives the bootstrap and definitions from a generated platform bundle', async () => {
    for (const [suffix, platform] of [
      ['-ios', 'ios'],
      ['-android', 'android'],
    ] as const) {
      const { bootstrap, defaults, definitions } = bundledConfigFromModule({
        // eslint-disable-next-line no-await-in-loop -- two small fixture reads
        bundle: await loadFixture(suffix),
      });
      expect(bootstrap.brandId).toBe('acme');
      expect(bootstrap.channel).toBe('stable');
      expect(bootstrap.platform).toBe(platform);
      expect(bootstrap.telemetryEndpoint).toBe('https://telemetry.example.invalid/acme');
      // Bundled defaults are served synchronously — offline first frame needs no network wait.
      expect(defaults['app.displayName']).toBe('Acme Studio');
      expect(defaults['modules.terminal.enabled']).toBe(false);
      expect(definitions['app.displayName'].defaultValue).toBe('Acme Studio');
    }
  });

  it('rejects a desktop bundle instead of running it on mobile', async () => {
    const fixtureDesktop = await loadFixture('');
    expect(() => bundledConfigFromModule({ bundle: fixtureDesktop })).toThrow(
      'targets desktop, not a mobile platform',
    );
  });

  it('fails closed on malformed modules and tampered bundles without falling back', async () => {
    expect(() => bundledConfigFromModule(null)).toThrow('must carry a bundle field');
    expect(() => bundledConfigFromModule({})).toThrow('must carry a bundle field');
    expect(() => bundledConfigFromModule({ bundle: undefined })).toThrow('expected object');
    const tampered = (await loadFixture('-ios')) as { snapshot: { sha256: string } };
    tampered.snapshot.sha256 = '0'.repeat(64);
    expect(() => bundledConfigFromModule({ bundle: tampered })).toThrow('sha256 does not match');
  });
});
