import { describe, expect, it } from 'vitest';
import { artifactKindForPath, fileBasename } from '../file-kind';

describe('artifactKindForPath', () => {
  it('maps viewer extensions to kinds', () => {
    expect(artifactKindForPath('/w/PLAN.md')).toBe('markdown');
    expect(artifactKindForPath('report.PDF')).toBe('pdf');
    expect(artifactKindForPath('a/b/logo.svg')).toBe('image');
    expect(artifactKindForPath('shot.webp')).toBe('image');
    expect(artifactKindForPath('notes.txt')).toBe('text');
    expect(artifactKindForPath('demo/clip.mp4')).toBe('video');
    expect(artifactKindForPath('capture.MOV')).toBe('video');
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
