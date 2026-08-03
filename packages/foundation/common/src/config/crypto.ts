import { hashes, verify } from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import type { ConfigCrypto } from './types';

hashes.sha512 = sha512;

export function createNobleConfigCrypto(randomUuid: () => string): ConfigCrypto {
  return {
    randomUuid,
    sha256: (bytes) => Promise.resolve(sha256(bytes)),
    verifyEd25519: (publicKey, signature, message) =>
      Promise.resolve(verify(signature, message, publicKey, { zip215: false })),
  };
}
