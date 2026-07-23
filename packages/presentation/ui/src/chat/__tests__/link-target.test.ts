import { describe, expect, it } from 'vitest';
import { faviconSrcFor, filePathTarget, linkTargetFor, linkTargetForUri } from '../link-target';

describe('linkTargetFor', () => {
  it('classifies web urls with their hostname', () => {
    expect(linkTargetFor('https://en.wikipedia.org/wiki/Arknights')).toStrictEqual({
      kind: 'web',
      href: 'https://en.wikipedia.org/wiki/Arknights',
      hostname: 'en.wikipedia.org',
    });
    expect(linkTargetFor('http://example.com')).toMatchObject({ hostname: 'example.com' });
  });

  it('classifies plugin mentions by stripping the scheme', () => {
    expect(linkTargetFor('plugin://computer-use@openai-bundled')).toStrictEqual({
      kind: 'plugin',
      id: 'computer-use@openai-bundled',
    });
    expect(linkTargetFor('plugin://')).toBeNull();
  });

  it('classifies absolute paths as files and strips line suffixes', () => {
    expect(linkTargetFor('/Users/z/Documents/outputs/demo.md')).toStrictEqual({
      kind: 'file',
      path: '/Users/z/Documents/outputs/demo.md',
    });
    expect(linkTargetFor('/Users/z/src/main.ts:12')).toStrictEqual({
      kind: 'file',
      path: '/Users/z/src/main.ts',
      line: 12,
    });
    expect(linkTargetFor('/Users/z/src/main.ts:12:5')).toStrictEqual({
      kind: 'file',
      path: '/Users/z/src/main.ts',
      line: 12,
    });
  });

  it('decodes percent-encoded path destinations', () => {
    expect(linkTargetFor('/Users/z/My%20Docs/%E8%B5%84%E6%96%99.md')).toStrictEqual({
      kind: 'file',
      path: '/Users/z/My Docs/资料.md',
    });
  });

  it('classifies SKILL.md paths as skills', () => {
    expect(
      linkTargetFor('/Users/z/.codex/plugins/cache/github/0.1.8/skills/github/SKILL.md'),
    ).toStrictEqual({
      kind: 'skill',
      path: '/Users/z/.codex/plugins/cache/github/0.1.8/skills/github/SKILL.md',
    });
  });

  it('classifies ./-prefixed relative destinations as workspace files', () => {
    expect(linkTargetFor('./.gitignore')).toStrictEqual({ kind: 'file', path: '.gitignore' });
    expect(linkTargetFor('./src/app%20%28v2%29/100%25/main.ts:12')).toStrictEqual({
      kind: 'file',
      path: 'src/app (v2)/100%/main.ts',
      line: 12,
    });
    expect(linkTargetFor('../shared/util.ts')).toStrictEqual({
      kind: 'file',
      path: '../shared/util.ts',
    });
    expect(linkTargetFor('./skills/github/SKILL.md')).toStrictEqual({
      kind: 'skill',
      path: 'skills/github/SKILL.md',
    });
  });

  it('classifies bare relative destinations that carry a file identity', () => {
    expect(linkTargetFor('package-lock.json')).toStrictEqual({
      kind: 'file',
      path: 'package-lock.json',
    });
    expect(linkTargetFor('src/main.rs:7')).toStrictEqual({
      kind: 'file',
      path: 'src/main.rs',
      line: 7,
    });
  });

  it('leaves fragments, schemes, and evidence-free relative urls alone', () => {
    expect(linkTargetFor(undefined)).toBeNull();
    expect(linkTargetFor('')).toBeNull();
    expect(linkTargetFor('#user-content-fn-1')).toBeNull();
    expect(linkTargetFor('mailto:someone@example.com')).toBeNull();
    expect(linkTargetFor('tel:+123456')).toBeNull();
    expect(linkTargetFor('release/notes')).toBeNull();
  });
});

describe('filePathTarget', () => {
  it('classifies tokens with recognized file identities', () => {
    expect(filePathTarget('package-lock.json')).toStrictEqual({
      kind: 'file',
      path: 'package-lock.json',
    });
    expect(filePathTarget('src/main.rs')).toStrictEqual({ kind: 'file', path: 'src/main.rs' });
    expect(filePathTarget('.gitignore')).toStrictEqual({ kind: 'file', path: '.gitignore' });
    expect(filePathTarget('Makefile')).toStrictEqual({ kind: 'file', path: 'Makefile' });
    expect(filePathTarget('./out/report.pdf')).toStrictEqual({
      kind: 'file',
      path: 'out/report.pdf',
    });
    expect(filePathTarget('/abs/path/logo.png')).toStrictEqual({
      kind: 'file',
      path: '/abs/path/logo.png',
    });
    expect(filePathTarget('src/foo.ts:42')).toStrictEqual({
      kind: 'file',
      path: 'src/foo.ts',
      line: 42,
    });
    expect(filePathTarget('skills/github/SKILL.md')).toStrictEqual({
      kind: 'skill',
      path: 'skills/github/SKILL.md',
    });
  });

  it('rejects prose that merely looks path-shaped', () => {
    expect(filePathTarget('foo.bar')).toBeNull();
    expect(filePathTarget('origin/main')).toBeNull();
    expect(filePathTarget('application/json')).toBeNull();
    expect(filePathTarget('and/or')).toBeNull();
    expect(filePathTarget('two words.md')).toBeNull();
    expect(filePathTarget('https://example.com/a.md')).toBeNull();
    expect(filePathTarget('mailto:user@example.com')).toBeNull();
    expect(filePathTarget('foo(bar)')).toBeNull();
    expect(filePathTarget('')).toBeNull();
    expect(filePathTarget(`${'x'.repeat(300)}.md`)).toBeNull();
  });
});

describe('linkTargetForUri', () => {
  it('maps file:// uris onto the file classification, decoded', () => {
    expect(linkTargetForUri('file:///mock/linkcode/docs/ARCHITECTURE.md')).toStrictEqual({
      kind: 'file',
      path: '/mock/linkcode/docs/ARCHITECTURE.md',
    });
    expect(linkTargetForUri('file:///Users/z/My%20Docs/%E8%B5%84%E6%96%99.md')).toStrictEqual({
      kind: 'file',
      path: '/Users/z/My Docs/资料.md',
    });
    expect(linkTargetForUri('file:///Users/z/skills/github/SKILL.md')).toStrictEqual({
      kind: 'skill',
      path: '/Users/z/skills/github/SKILL.md',
    });
  });

  it('keeps web, plugin, and absolute-path classification', () => {
    expect(linkTargetForUri('https://example.com/doc')).toMatchObject({ kind: 'web' });
    expect(linkTargetForUri('plugin://computer-use')).toMatchObject({ kind: 'plugin' });
    expect(linkTargetForUri('/Users/z/demo.md')).toMatchObject({ kind: 'file' });
  });

  it('falls back to a generic uri target for unknown schemes', () => {
    expect(linkTargetForUri('mock://notes/showcase.md')).toStrictEqual({
      kind: 'uri',
      uri: 'mock://notes/showcase.md',
    });
  });
});

describe('faviconSrcFor', () => {
  it('builds the google s2 url for a hostname', () => {
    expect(faviconSrcFor('en.wikipedia.org')).toBe(
      'https://www.google.com/s2/favicons?domain=en.wikipedia.org&sz=32',
    );
  });
});
