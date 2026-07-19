import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FileSuggestService } from '../workspace/file-suggest-service';

/** Fresh service per call: no TTL-cached file list leaks between tests. */
function suggest(cwd: string, query: string, limit?: number) {
  return new FileSuggestService().suggest(cwd, query, limit);
}

const roots: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'linkcode-suggest-test-'));
  roots.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  // The fixture repos must not inherit the machine's commit signing (a locked
  // signer would fail every `git commit` here).
  execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe('FileSuggestService', () => {
  it('respects .gitignore in a git workspace, including untracked files', async () => {
    const dir = makeTempDir();
    git(dir, 'init', '-b', 'main');
    writeFileSync(join(dir, '.gitignore'), 'ignored.log\n');
    writeFileSync(join(dir, 'tracked.ts'), 'a');
    writeFileSync(join(dir, 'untracked.ts'), 'b');
    writeFileSync(join(dir, 'ignored.log'), 'c');
    git(dir, 'add', 'tracked.ts');

    const paths = (await suggest(dir, '')).map((s) => s.path);
    expect(paths).toContain('tracked.ts');
    expect(paths).toContain('untracked.ts');
    expect(paths).not.toContain('ignored.log');
  });

  it('falls back to a bounded walk for non-git workspaces, skipping heavy trees', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'notes.md'), 'a');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'main.ts'), 'b');
    mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'c');
    mkdirSync(join(dir, '.hidden'));
    writeFileSync(join(dir, '.hidden', 'secret.ts'), 'd');

    const paths = (await suggest(dir, '')).map((s) => s.path);
    expect(paths).toContain('notes.md');
    expect(paths).toContain('src/main.ts');
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
    expect(paths.some((p) => p.includes('.hidden'))).toBe(false);
  });

  it('ranks basename matches above path matches, shallow before deep', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'composer'));
    writeFileSync(join(dir, 'composer', 'readme.md'), '');
    writeFileSync(join(dir, 'composer.tsx'), '');
    writeFileSync(join(dir, 'my-composer-utils.ts'), '');
    mkdirSync(join(dir, 'deep', 'nested'), { recursive: true });
    writeFileSync(join(dir, 'deep', 'nested', 'composer.tsx'), '');

    const paths = (await suggest(dir, 'composer')).map((s) => s.path);
    // Tier 1 (basename prefix) before tier 2 (basename substring) before tier 3
    // (path-only substring); within tier 1 shallow beats deep.
    expect(paths[0]).toBe('composer.tsx');
    expect(paths[1]).toBe('deep/nested/composer.tsx');
    expect(paths[2]).toBe('my-composer-utils.ts');
    expect(paths[3]).toBe('composer/readme.md');
  });

  it('matches case-insensitively and drops non-matches', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, 'README.md'), '');
    writeFileSync(join(dir, 'other.ts'), '');

    const paths = (await suggest(dir, 'readme')).map((s) => s.path);
    expect(paths).toEqual(['README.md']);
  });

  it('applies the result limit', async () => {
    const dir = makeTempDir();
    for (let i = 0; i < 10; i++) writeFileSync(join(dir, `file-${i}.txt`), '');

    const suggestions = await suggest(dir, 'file', 3);
    expect(suggestions).toHaveLength(3);
  });

  it('orders an empty query shallow-first (browse mode)', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'deep.ts'), '');
    writeFileSync(join(dir, 'top.ts'), '');

    const paths = (await suggest(dir, '')).map((s) => s.path);
    expect(paths).toEqual(['top.ts', 'sub/deep.ts']);
  });

  it('list returns the full enumeration, unranked and beyond the suggest limit', async () => {
    const dir = makeTempDir();
    writeFileSync(join(dir, '.gitignore'), 'ignored.log\n');
    git(dir, 'init', '-b', 'main');
    writeFileSync(join(dir, 'ignored.log'), '');
    for (let i = 0; i < 60; i++) {
      writeFileSync(join(dir, `file-${String(i).padStart(2, '0')}.txt`), '');
    }

    const files = await new FileSuggestService().list(dir);
    expect(files).toHaveLength(61); // 60 files + .gitignore; no DEFAULT_SUGGEST_LIMIT cap.
    expect(files).not.toContain('ignored.log');
  });
});
