/// <reference types="node" />
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TgzFixture {
  archive: string;
  bytes: Buffer;
  integrity: string;
}

/** Build a real single-member tgz with the system tar (dev machines are posix). */
export function makeTgz(member: string, content: string): TgzFixture {
  const root = mkdtempSync(join(tmpdir(), 'tgz-fixture-'));
  const file = join(root, member);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, { mode: 0o644 });
  const archive = join(root, 'fixture.tgz');
  execFileSync('tar', ['-czf', archive, '-C', root, member]);
  const bytes = readFileSync(archive);
  return {
    archive,
    bytes,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
}

/** Build an npm-shaped tgz: every file under the standard `package/` root. */
export function makePackageTgz(files: Record<string, string>): TgzFixture {
  const root = mkdtempSync(join(tmpdir(), 'pkg-fixture-'));
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, 'package', name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, { mode: 0o644 });
  }
  const archive = join(root, 'fixture.tgz');
  execFileSync('tar', ['-czf', archive, '-C', root, 'package']);
  const bytes = readFileSync(archive);
  return {
    archive,
    bytes,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
}
