import { describe, expect, it } from 'vitest';
import { declaredMimeTypeMatches, sniffImageMimeType } from '../mime-sniff';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('mime sniff', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const webp = new Uint8Array(16);
  webp.set(bytes('RIFF'), 0);
  webp.set(bytes('WEBPVP8 '), 8);

  it('recognizes the supported image types and nothing else', () => {
    expect(sniffImageMimeType(png)).toBe('image/png');
    expect(sniffImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageMimeType(bytes('GIF89a......'))).toBe('image/gif');
    expect(sniffImageMimeType(webp)).toBe('image/webp');
    expect(sniffImageMimeType(bytes('RIFF....WAVE'))).toBeUndefined();
    expect(sniffImageMimeType(bytes('%PDF-1.7'))).toBeUndefined();
    expect(sniffImageMimeType(new Uint8Array(0))).toBeUndefined();
  });

  it('holds sniffable image declarations to their bytes and trusts the rest', () => {
    expect(declaredMimeTypeMatches('image/png', png)).toBe(true);
    expect(declaredMimeTypeMatches('image/jpeg', png)).toBe(false);
    expect(declaredMimeTypeMatches('image/jpeg', bytes('<svg/>'))).toBe(false);
    expect(declaredMimeTypeMatches('image/svg+xml', bytes('<svg/>'))).toBe(true);
    expect(declaredMimeTypeMatches('image/svg+xml', png)).toBe(false);
    expect(declaredMimeTypeMatches('image/heic', bytes('ftypheic'))).toBe(true);
    expect(declaredMimeTypeMatches('application/pdf', bytes('%PDF-1.7'))).toBe(true);
    expect(declaredMimeTypeMatches('text/plain', png)).toBe(true);
  });
});
