import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BRAND_ASSET_ICON, stageBrandAssets } from '../brand-assets';

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const RE_ABSENT = /does not exist/;
const RE_ESCAPES_CHECKOUT = /escapes the structural checkout/;
const RE_SYMLINK = /must not be a symlink/;
const RE_NOT_REGULAR_FILE = /regular file/;
const RE_MISSING_ICON = /missing icon\.png/;
const RE_NOT_PNG = /not a PNG file/;
const RE_INVALID_SIZE = /invalid size/;

let workDir: string;
let outDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'brand-assets-'));
  outDir = join(workDir, 'out');
});

afterEach(() => {
  rmSync(workDir, { force: true, recursive: true });
});

function makeAssets(brandId: string, iconBody = brandId): string {
  const dir = join(workDir, 'structural', 'brands', brandId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, BRAND_ASSET_ICON), Buffer.concat([PNG_MAGIC, Buffer.from(iconBody)]));
  return dir;
}

function structuralDir(): string {
  return join(workDir, 'structural');
}

describe('stageBrandAssets', () => {
  it('stages exactly the selected brand and reports content digests', () => {
    makeAssets('acme');
    makeAssets('zenith');
    const staged = stageBrandAssets({
      assetsPath: 'brands/acme',
      outDir,
      structuralDir: structuralDir(),
    });
    expect(staged.map(({ name }) => name)).toEqual([BRAND_ASSET_ICON]);
    expect(readdirSync(outDir)).toEqual([BRAND_ASSET_ICON]);
    // The staged bytes are the acme bytes, not the zenith bytes.
    expect(readFileSync(join(outDir, BRAND_ASSET_ICON)).toString('latin1')).toContain('acme');
  });

  it('is deterministic: re-staging yields identical bytes and digests', () => {
    makeAssets('acme');
    const first = stageBrandAssets({
      assetsPath: 'brands/acme',
      outDir,
      structuralDir: structuralDir(),
    });
    const firstBytes = readFileSync(join(outDir, BRAND_ASSET_ICON));
    const second = stageBrandAssets({
      assetsPath: 'brands/acme',
      outDir,
      structuralDir: structuralDir(),
    });
    expect(second).toEqual(first);
    expect(readFileSync(join(outDir, BRAND_ASSET_ICON)).equals(firstBytes)).toBe(true);
  });

  it("replaces a previous brand's output wholesale — no cross-brand leftovers", () => {
    makeAssets('acme');
    const zenithDir = makeAssets('zenith');
    writeFileSync(
      join(zenithDir, 'extra.png'),
      Buffer.concat([PNG_MAGIC, Buffer.from('zenith-extra')]),
    );
    stageBrandAssets({ assetsPath: 'brands/zenith', outDir, structuralDir: structuralDir() });
    expect(readdirSync(outDir).sort()).toEqual(['extra.png', BRAND_ASSET_ICON].sort());
    stageBrandAssets({ assetsPath: 'brands/acme', outDir, structuralDir: structuralDir() });
    expect(readdirSync(outDir)).toEqual([BRAND_ASSET_ICON]);
    expect(readFileSync(join(outDir, BRAND_ASSET_ICON)).toString('latin1')).toContain('acme');
  });

  it('rejects a missing assets directory', () => {
    expect(() =>
      stageBrandAssets({ assetsPath: 'brands/ghost', outDir, structuralDir: structuralDir() }),
    ).toThrow(RE_ABSENT);
  });

  it('rejects a path that escapes the structural checkout', () => {
    makeAssets('acme');
    expect(() =>
      stageBrandAssets({
        assetsPath: '../escape',
        outDir,
        structuralDir: join(workDir, 'structural', 'brands'),
      }),
    ).toThrow(RE_ESCAPES_CHECKOUT);
  });

  it('rejects a symlinked assets directory', () => {
    const real = makeAssets('acme');
    symlinkSync(real, join(workDir, 'structural', 'brands', 'evil'));
    expect(() =>
      stageBrandAssets({ assetsPath: 'brands/evil', outDir, structuralDir: structuralDir() }),
    ).toThrow(RE_SYMLINK);
  });

  it('rejects a symlinked asset file pointing at another brand', () => {
    const acme = makeAssets('acme');
    const zenith = makeAssets('zenith');
    symlinkSync(join(zenith, BRAND_ASSET_ICON), join(acme, 'stolen.png'));
    expect(() =>
      stageBrandAssets({ assetsPath: 'brands/acme', outDir, structuralDir: structuralDir() }),
    ).toThrow(RE_SYMLINK);
  });

  it('rejects nested directories (asset set v1 is flat)', () => {
    const dir = makeAssets('acme');
    mkdirSync(join(dir, 'nested'));
    expect(() =>
      stageBrandAssets({ assetsPath: 'brands/acme', outDir, structuralDir: structuralDir() }),
    ).toThrow(RE_NOT_REGULAR_FILE);
  });

  it('rejects a directory without the required icon', () => {
    const dir = makeAssets('acme');
    rmSync(join(dir, BRAND_ASSET_ICON));
    writeFileSync(join(dir, 'other.png'), Buffer.concat([PNG_MAGIC, Buffer.from('x')]));
    expect(() =>
      stageBrandAssets({ assetsPath: 'brands/acme', outDir, structuralDir: structuralDir() }),
    ).toThrow(RE_MISSING_ICON);
  });

  it('rejects an icon without PNG magic bytes', () => {
    const dir = makeAssets('acme');
    writeFileSync(join(dir, BRAND_ASSET_ICON), Buffer.from('not a png at all'));
    expect(() =>
      stageBrandAssets({ assetsPath: 'brands/acme', outDir, structuralDir: structuralDir() }),
    ).toThrow(RE_NOT_PNG);
  });

  it('rejects an empty asset file and leaves no partial output behind', () => {
    const dir = makeAssets('acme');
    writeFileSync(join(dir, 'empty.txt'), '');
    expect(() =>
      stageBrandAssets({ assetsPath: 'brands/acme', outDir, structuralDir: structuralDir() }),
    ).toThrow(RE_INVALID_SIZE);
    // Validation happens before the output directory is touched.
    expect(() => readdirSync(outDir)).toThrow();
  });
});
