import { describe, expect, it } from 'vitest';
import { isPreviewHostname, normalizeHostname } from '../preview-routes';

describe('preview hostname classification', () => {
  it('normalizes Host headers and recognizes the namespace', () => {
    expect(normalizeHostname('Web--App.LOCALHOST:19523')).toBe('web--app.localhost');
    expect(normalizeHostname(undefined)).toBeNull();
    expect(normalizeHostname('[::1]:19523')).toBeNull();
    expect(isPreviewHostname('web--app-1a2b3c.localhost')).toBe(true);
    expect(isPreviewHostname('localhost')).toBe(false);
    expect(isPreviewHostname('web.localhost')).toBe(false);
    expect(isPreviewHostname('web--app.example.com')).toBe(false);
  });
});
