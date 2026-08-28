import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendArrayInPlace } from 'foxts/append-array-in-place';

const CONFIG_FILE_PAIRS = [
  ['config-build-bundle.json', 'build-bundle.json'],
  ['brand-identity.json', 'brand-identity.json'],
  ['electron-builder.brand.json', 'electron-builder.brand.json'],
  ['brand-assets/icon.png', 'brand-assets/icon.png'],
] as const;

const collator = new Intl.Collator();

function listFiles(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    collator.compare(a.name, b.name),
  );
  for (let i = 0, len = entries.length; i < len; i++) {
    const entry = entries[i];
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) appendArrayInPlace(files, listFiles(join(dir, entry.name), relative));
    else files.push(relative);
  }
  return files;
}

function assertFiles(actual: readonly string[], expected: readonly string[], label: string): void {
  if (
    actual.length === expected.length &&
    actual.every((file, index) => file === expected[index])
  ) {
    return;
  }
  throw new Error(
    `${label} does not match a complete desktop config build — rebuild before packaging`,
  );
}

/** Refuses packaging when generated inputs no longer match the files staged by the Vite build. */
export function assertStagedConfigMatchesGenerated(desktopDir: string): boolean {
  const generatedDir = join(desktopDir, 'generated');
  const outConfig = join(desktopDir, 'out', 'config');
  const generatedFiles = listFiles(generatedDir);
  const branded = generatedFiles.includes('brand-identity.json');
  if (generatedFiles.includes('config-build-bundle.json')) {
    const bundle = JSON.parse(
      readFileSync(join(generatedDir, 'config-build-bundle.json'), 'utf8'),
    ) as { brandId?: unknown };
    if (typeof bundle.brandId !== 'string' || (bundle.brandId !== 'linkcode') !== branded) {
      throw new Error(
        'apps/desktop/generated brand artifacts do not match the config bundle — rebuild before packaging',
      );
    }
  }
  const pairs =
    generatedFiles.length === 0 ? [] : branded ? CONFIG_FILE_PAIRS : CONFIG_FILE_PAIRS.slice(0, 1);
  assertFiles(
    generatedFiles,
    pairs.map(([generated]) => generated).sort(),
    'apps/desktop/generated',
  );
  assertFiles(
    listFiles(outConfig),
    pairs.map(([, staged]) => staged).sort(),
    'apps/desktop/out/config',
  );
  for (let i = 0, len = pairs.length; i < len; i++) {
    const [generated, staged] = pairs[i];
    if (
      !readFileSync(join(generatedDir, generated)).equals(readFileSync(join(outConfig, staged)))
    ) {
      throw new Error(
        `apps/desktop/out/config/${staged} does not match generated/${generated} — rebuild before packaging`,
      );
    }
  }
  return branded;
}
