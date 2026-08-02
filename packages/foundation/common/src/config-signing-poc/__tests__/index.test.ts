import { describe, expect, it } from 'vitest';
import { decodeBase64Url, runNobleConfigSigningPoc, runWebCryptoConfigSigningPoc } from '..';

describe('client config signing vector', () => {
  it('verifies JCS, Base64URL, SHA-256, and Ed25519 with the portable Noble path', () => {
    expect(runNobleConfigSigningPoc()).toEqual({
      canonicalPayloadSha256: 'd3fcd06bb81156590026099066bf54f896cf69a1f63073292001a702ef77411f',
      emergencySignatureValid: true,
      pointerSignatureValid: true,
      rfc8032SignatureValid: true,
      snapshotSha256: '513910f70984fbd2290d4538d8e668a8b9d853b466921e6839695b2d98b10e97',
    });
  });

  it('verifies the same bytes with WebCrypto', async () => {
    await expect(runWebCryptoConfigSigningPoc(crypto.subtle)).resolves.toEqual({
      canonicalPayloadSha256: 'd3fcd06bb81156590026099066bf54f896cf69a1f63073292001a702ef77411f',
      emergencySignatureValid: true,
      pointerSignatureValid: true,
      rfc8032SignatureValid: true,
      snapshotSha256: '513910f70984fbd2290d4538d8e668a8b9d853b466921e6839695b2d98b10e97',
    });
  });

  it('rejects malformed Base64URL', () => {
    expect(() => decodeBase64Url('a')).toThrow('Invalid Base64URL value');
    expect(() => decodeBase64Url('ch')).toThrow('Invalid Base64URL value');
    expect(() => decodeBase64Url('cg==')).toThrow('Invalid Base64URL value');
    expect(decodeBase64Url('cg')).toEqual(new Uint8Array([114]));
  });
});
