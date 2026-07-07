import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rewriteAsarSpawnPath } from '../asar-spawn';

// Plain directories literally named `app.asar` / `app.asar.unpacked` — outside Electron nothing
// treats the asar name specially, which is exactly what the rewrite's existsSync probe needs.
function makeAppLayout(): string {
  return mkdtempSync(join(tmpdir(), 'linkcode-asar-'));
}

describe('rewriteAsarSpawnPath', () => {
  it('rewrites an asar path whose unpacked copy exists', () => {
    const root = makeAppLayout();
    const unpackedDir = join(root, 'app.asar.unpacked', 'node_modules', 'pkg');
    mkdirSync(unpackedDir, { recursive: true });
    writeFileSync(join(unpackedDir, 'bin'), '');
    const asarPath = join(root, 'app.asar', 'node_modules', 'pkg', 'bin');
    expect(rewriteAsarSpawnPath(asarPath)).toBe(join(unpackedDir, 'bin'));
  });

  it('leaves an asar path alone when no unpacked copy exists', () => {
    const root = makeAppLayout();
    const asarPath = join(root, 'app.asar', 'node_modules', 'pkg', 'bin');
    expect(rewriteAsarSpawnPath(asarPath)).toBe(asarPath);
  });

  it('leaves non-asar paths alone', () => {
    expect(rewriteAsarSpawnPath('/usr/local/bin/claude')).toBe('/usr/local/bin/claude');
    // A file merely named with the prefix must not match the path-segment probe.
    expect(rewriteAsarSpawnPath('/opt/app.asarx/bin')).toBe('/opt/app.asarx/bin');
  });

  it('does not rewrite paths already inside app.asar.unpacked', () => {
    const root = makeAppLayout();
    const unpackedDir = join(root, 'app.asar.unpacked', 'node_modules', 'pkg');
    mkdirSync(unpackedDir, { recursive: true });
    writeFileSync(join(unpackedDir, 'bin'), '');
    const unpackedPath = join(unpackedDir, 'bin');
    expect(rewriteAsarSpawnPath(unpackedPath)).toBe(unpackedPath);
  });
});
