import { describe, expect, it } from 'vitest';
import { codeLanguageForResource } from '../code-language';

describe('codeLanguageForResource', () => {
  it('prefers a recognized MIME type over a misleading path', () => {
    expect(codeLanguageForResource('mock://result.txt', 'application/json; charset=utf-8')).toBe(
      'json',
    );
  });

  it('falls back to a query-free file extension', () => {
    expect(codeLanguageForResource('file:///repo/source.ts?revision=2')).toBe('ts');
  });

  it('leaves an extensionless resource unclassified', () => {
    expect(codeLanguageForResource('mock://opaque/resource')).toBeUndefined();
  });
});
