import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readWorkspaceFile } from '../workspace/file-service';

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
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    writeFileSync(join(root, 'pic.png'), bytes);

    const file = await readWorkspaceFile(root, 'pic.png');
    expect(file.encoding).toBe('base64');
    expect(Buffer.from(file.content, 'base64')).toEqual(bytes);
    expect(file.mimeType).toBe('image/png');
  });

  it('returns known-binary types as base64 even without a NUL in the sniff window', async () => {
    const root = makeTempDir();
    // A minimal, all-ASCII PDF header — no NUL byte, so the sniff alone would misread it as utf8.
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n');
    writeFileSync(join(root, 'doc.pdf'), pdf);

    const file = await readWorkspaceFile(root, 'doc.pdf');
    expect(file.mimeType).toBe('application/pdf');
    expect(file.encoding).toBe('base64');
    expect(Buffer.from(file.content, 'base64')).toEqual(pdf);
  });

  it('keeps svg as utf8 text (it is XML, not binary)', async () => {
    const root = makeTempDir();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    writeFileSync(join(root, 'icon.svg'), svg);

    const file = await readWorkspaceFile(root, 'icon.svg');
    expect(file.mimeType).toBe('image/svg+xml');
    expect(file.encoding).toBe('utf8');
    expect(file.content).toBe(svg);
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

  it('reads files outside the workspace (agents write anywhere the user can)', async () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    writeFileSync(join(outside, 'note.txt'), 'outside');

    const absolute = await readWorkspaceFile(root, join(outside, 'note.txt'));
    expect(absolute.content).toBe('outside');

    const traversal = await readWorkspaceFile(root, relative(root, join(outside, 'note.txt')));
    expect(traversal.content).toBe('outside');
    expect(traversal.path).toBe(join(outside, 'note.txt'));
  });

  it('follows symlinks out of the workspace', async () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    writeFileSync(join(outside, 'target.txt'), 'linked');
    symlinkSync(join(outside, 'target.txt'), join(root, 'link.md'));

    const file = await readWorkspaceFile(root, 'link.md');
    expect(file.content).toBe('linked');
  });

  it('propagates a missing-file error with the resolved path', async () => {
    const root = makeTempDir();
    await expect(readWorkspaceFile(root, 'absent.pdf')).rejects.toThrow(/ENOENT/);
  });

  it('rejects directories', async () => {
    const root = makeTempDir();
    mkdirSync(join(root, 'dir'));
    await expect(readWorkspaceFile(root, 'dir')).rejects.toThrow();
  });
});
