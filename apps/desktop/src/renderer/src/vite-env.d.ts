/// <reference types="vite/client" />

interface ConfigSigningPocResult {
  canonicalPayloadSha256: string;
  emergencySignatureValid: boolean;
  pointerSignatureValid: boolean;
  rfc8032SignatureValid: boolean;
  snapshotSha256: string;
}

/** Inlined by vite.renderer.config.ts from the main-process Sentry configuration. */
declare const __LINKCODE_SENTRY_ENABLED__: boolean;

interface Window {
  configSigningPoc?: Promise<{
    noble: ConfigSigningPocResult;
    webCrypto: ConfigSigningPocResult;
  }>;
}
