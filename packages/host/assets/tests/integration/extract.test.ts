import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExtractError } from '../../src/errors';
import { extractMember } from '../../src/extract';
import { makeTgz } from './helpers/fixtures';

function dest(): string {
  return join(mkdtempSync(join(tmpdir(), 'extract-')), 'out', 'tool');
}

describe('extractMember', () => {
  it('extracts the declared member to exactly the destination, executable on posix', async () => {
    const fixture = makeTgz('package/bin/tool', '#!/bin/sh\necho ok\n');
    const file = dest();
    await extractMember(fixture.archive, 'tgz', 'package/bin/tool', file);
    expect(readFileSync(file, 'utf8')).toContain('echo ok');
    expect(statSync(file).mode & 0o111).not.toBe(0);
  });

  it('rejects archives missing the declared member', async () => {
    const fixture = makeTgz('package/other', 'nope');
    await expect(extractMember(fixture.archive, 'tgz', 'package/bin/tool', dest())).rejects.toThrow(
      ExtractError,
    );
  });

  it('requires a member declaration for archive formats', async () => {
    const fixture = makeTgz('package/bin/tool', 'x');
    await expect(extractMember(fixture.archive, 'tgz', undefined, dest())).rejects.toThrow(
      ExtractError,
    );
  });

  it('copies raw artifacts as-is', async () => {
    const root = mkdtempSync(join(tmpdir(), 'raw-'));
    const source = join(root, 'binary');
    writeFileSync(source, 'raw-bytes');
    const file = dest();
    await extractMember(source, 'raw', undefined, file);
    expect(readFileSync(file, 'utf8')).toBe('raw-bytes');
    expect(statSync(file).mode & 0o111).not.toBe(0);
  });
});
