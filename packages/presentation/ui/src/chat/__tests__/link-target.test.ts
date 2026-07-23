import { describe, expect, it } from 'vitest';
import { faviconSrcFor, linkTargetFor, linkTargetForUri } from '../link-target';

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

  it('leaves fragments, relative urls, and other schemes alone', () => {
    expect(linkTargetFor(undefined)).toBeNull();
    expect(linkTargetFor('')).toBeNull();
    expect(linkTargetFor('#user-content-fn-1')).toBeNull();
    expect(linkTargetFor('mailto:someone@example.com')).toBeNull();
    expect(linkTargetFor('tel:+123456')).toBeNull();
    expect(linkTargetFor('docs/readme.md')).toBeNull();
    expect(linkTargetFor('./relative.md')).toBeNull();
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
