import { describe, expect, it } from 'vitest';
import { artifactKindForPath, detectInlineFilePath, fileBasename } from '../file-kind';

describe('artifactKindForPath', () => {
  it('maps viewer extensions to kinds', () => {
    expect(artifactKindForPath('/w/PLAN.md')).toBe('markdown');
    expect(artifactKindForPath('report.PDF')).toBe('pdf');
    expect(artifactKindForPath('a/b/logo.svg')).toBe('image');
    expect(artifactKindForPath('shot.webp')).toBe('image');
    expect(artifactKindForPath('notes.txt')).toBe('text');
  });

  it('returns null for unknown or missing extensions', () => {
    expect(artifactKindForPath('main.rs')).toBeNull();
    expect(artifactKindForPath('Makefile')).toBeNull();
    expect(artifactKindForPath('.gitignore')).toBeNull();
  });
});

describe('fileBasename', () => {
  it('strips directories', () => {
    expect(fileBasename('/a/b/c.md')).toBe('c.md');
    expect(fileBasename(String.raw`C:\repo\docs\c.md`)).toBe('c.md');
    expect(fileBasename('c.md')).toBe('c.md');
  });
});

describe('detectInlineFilePath', () => {
  it('accepts viewer-openable single-token paths', () => {
    expect(detectInlineFilePath('PLAN.md')).toBe('PLAN.md');
    expect(detectInlineFilePath('docs/spec.md')).toBe('docs/spec.md');
    expect(detectInlineFilePath('./out/report.pdf')).toBe('./out/report.pdf');
    expect(detectInlineFilePath('/abs/path/logo.png')).toBe('/abs/path/logo.png');
  });

  it('rejects non-paths and unviewable files', () => {
    expect(detectInlineFilePath('foo.bar')).toBeNull();
    expect(detectInlineFilePath('main.rs')).toBeNull();
    expect(detectInlineFilePath('two words.md')).toBeNull();
    expect(detectInlineFilePath('https://example.com/a.md')).toBeNull();
    expect(detectInlineFilePath('`quoted.md`')).toBeNull();
    expect(detectInlineFilePath('')).toBeNull();
    expect(detectInlineFilePath(`${'x'.repeat(300)}.md`)).toBeNull();
  });
});
