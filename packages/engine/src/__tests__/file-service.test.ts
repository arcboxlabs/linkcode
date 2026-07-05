import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readWorkspaceFile } from '../file-service';

const roots: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'linkcode-file-test-'));
  roots.push(dir);
  return dir;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('readWorkspaceFile', () => {
  it('reads utf8 text with size, mtime, and mime', async () => {
    const root = makeTempDir();
    writeFileSync(join(root, 'PLAN.md'), '# Plan\n\nhello');

    const file = await readWorkspaceFile(root, 'PLAN.md');
    expect(file.encoding).toBe('utf8');
    expect(file.content).toBe('# Plan\n\nhello');
    expect(file.size).toBe(Buffer.byteLength('# Plan\n\nhello'));
    expect(file.mimeType).toBe('text/markdown');
    expect(file.mtimeMs).toBeGreaterThan(0);
  });

  it('detects binary content and returns base64', async () => {
    const root = makeTempDir();
    // PNG magic prefix plus a NUL byte to trip the binary sniff.
    const bytes = Buffer.from([137, 80, 78, 71, 0, 1, 2]);
    writeFileSync(join(root, 'pic.png'), bytes);

    const file = await readWorkspaceFile(root, 'pic.png');
    expect(file.encoding).toBe('base64');
    expect(Buffer.from(file.content, 'base64')).toEqual(bytes);
    expect(file.mimeType).toBe('image/png');
  });

  it('resolves relative paths against cwd and accepts in-root absolute paths', async () => {
    const root = makeTempDir();
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'a.txt'), 'a');

    const relative = await readWorkspaceFile(root, 'docs/a.txt');
    const absolute = await readWorkspaceFile(root, join(root, 'docs', 'a.txt'));
    expect(relative.content).toBe('a');
    expect(absolute.path).toBe(relative.path);
  });

  it('rejects .. traversal out of the workspace', async () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    writeFileSync(join(outside, 'secret.txt'), 'nope');

    await expect(
      readWorkspaceFile(join(root), join('..', outside, 'secret.txt')),
    ).rejects.toThrow();
    await expect(readWorkspaceFile(root, '../secret.txt')).rejects.toThrow();
  });

  it('rejects symlinks that escape the workspace', async () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    writeFileSync(join(outside, 'secret.txt'), 'nope');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'innocent.md'));

    await expect(readWorkspaceFile(root, 'innocent.md')).rejects.toThrow(/escapes/);
  });

  it('rejects directories', async () => {
    const root = makeTempDir();
    mkdirSync(join(root, 'dir'));
    await expect(readWorkspaceFile(root, 'dir')).rejects.toThrow();
  });
});
