import { describe, expect, it } from 'vitest';
import { isAllowedBrowserUrl, normalizeBrowserUrl } from '../normalize';

describe('normalizeBrowserUrl', () => {
  it('defaults loopback authorities to http', () => {
    expect(normalizeBrowserUrl('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeBrowserUrl('web--app-1a2b3c.localhost:19523/x')).toBe(
      'http://web--app-1a2b3c.localhost:19523/x',
    );
    expect(normalizeBrowserUrl('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(normalizeBrowserUrl('[::1]:8080')).toBe('http://[::1]:8080');
  });

  it('keeps explicit schemes and defaults the web to https', () => {
    expect(normalizeBrowserUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeBrowserUrl('example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(normalizeBrowserUrl('//cdn.example.com/x')).toBe('https://cdn.example.com/x');
    expect(normalizeBrowserUrl('  ')).toBe('');
  });
});

describe('isAllowedBrowserUrl', () => {
  it('allows only http(s)', () => {
    expect(isAllowedBrowserUrl('http://a.localhost')).toBe(true);
    expect(isAllowedBrowserUrl('https://example.com')).toBe(true);
    expect(isAllowedBrowserUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedBrowserUrl('javascript:alert(1)')).toBe(false);
  });
});
