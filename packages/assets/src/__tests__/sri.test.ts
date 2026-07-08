import { describe, expect, it } from 'vitest';
import { IntegrityError } from '../errors';
import { strongestSriDigest } from '../sri';

describe('strongestSriDigest', () => {
  it('parses a single sha512 entry, preserving base64 characters', () => {
    const digest = 'kL+kkQ/kkPz1kOBu9Yy0stlM8U0erOK4Wg==';
    expect(strongestSriDigest(`sha512-${digest}`)).toEqual({ algorithm: 'sha512', digest });
  });

  it('picks the strongest algorithm out of a multi-hash string regardless of order', () => {
    expect(strongestSriDigest('sha256-aaa sha512-bbb')).toEqual({
      algorithm: 'sha512',
      digest: 'bbb',
    });
    expect(strongestSriDigest('sha384-ccc sha256-aaa')).toEqual({
      algorithm: 'sha384',
      digest: 'ccc',
    });
  });

  it('ignores unsupported algorithms next to a supported one', () => {
    expect(strongestSriDigest('md5-zzz sha256-aaa')).toEqual({
      algorithm: 'sha256',
      digest: 'aaa',
    });
  });

  it('strips SRI option suffixes', () => {
    expect(strongestSriDigest('sha512-bbb?async')).toEqual({ algorithm: 'sha512', digest: 'bbb' });
  });

  it('rejects strings with no usable digest', () => {
    expect(() => strongestSriDigest('md5-zzz')).toThrow(IntegrityError);
    expect(() => strongestSriDigest('sha512-')).toThrow(IntegrityError);
    expect(() => strongestSriDigest('')).toThrow(IntegrityError);
  });
});
