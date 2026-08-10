import { describe, expect, it } from 'vitest';
import inputsModule from './release-inputs.cjs';

const { validateReleaseInputs } = inputsModule;
const RE_RENDER_MISSING = /var CONFIG_RELEASE_KEYRINGS.*var CONFIG_RELEASE_REVISION/;
const RE_MOBILE_SIGNING =
  /secret EXPO_TOKEN.*secret POSTHOG_PROJECT_TOKEN.*var POSTHOG_HOST.*secret SENTRY_AUTH_TOKEN.*secret SENTRY_DSN_MOBILE/;
const RE_DESKTOP_UPLOAD = /R2_ACCESS_KEY_ID.*R2_ACCOUNT_ID.*R2_SECRET_ACCESS_KEY/;
const RE_INVALID_KEY = /must encode an App Store Connect \.p8 key/;
const RE_INVALID_ACCOUNT = /must be a lowercase 32-hex Cloudflare account ID/;

describe('validateReleaseInputs', () => {
  it('reports absent render vars by exact GitHub name', () => {
    expect(() => validateReleaseInputs({ env: {}, phase: 'render', platform: 'desktop' })).toThrow(
      RE_RENDER_MISSING,
    );
  });

  it('requires signing and upload inputs only for the requested platform', () => {
    expect(() => validateReleaseInputs({ env: {}, phase: 'sign', platform: 'mobile' })).toThrow(
      RE_MOBILE_SIGNING,
    );
    expect(() =>
      validateReleaseInputs({
        env: { EXPO_TOKEN: 'non-production-test' },
        phase: 'upload',
        platform: 'mobile',
      }),
    ).not.toThrow();
    expect(() => validateReleaseInputs({ env: {}, phase: 'upload', platform: 'desktop' })).toThrow(
      RE_DESKTOP_UPLOAD,
    );
  });

  it('rejects malformed desktop notarization key material', () => {
    const env = Object.fromEntries(
      [
        'APPLE_API_KEY_BASE64',
        'APPLE_API_KEY_ID',
        'APPLE_API_ISSUER',
        'APPLE_TEAM_ID',
        'AZURE_CERTIFICATE_PROFILE',
        'AZURE_CLIENT_ID',
        'AZURE_CODE_SIGNING_ACCOUNT',
        'AZURE_PUBLISHER_NAME',
        'AZURE_SIGN_ENDPOINT',
        'AZURE_TENANT_ID',
        'MACOS_CSC_KEY_PASSWORD',
        'MACOS_CSC_LINK',
        'POSTHOG_HOST',
        'POSTHOG_PROJECT_TOKEN',
        'SENTRY_DSN_DESKTOP',
      ].map((name) => [name, 'set']),
    );
    expect(() => validateReleaseInputs({ env, phase: 'sign', platform: 'desktop' })).toThrow(
      RE_INVALID_KEY,
    );
  });

  it('rejects an R2 account value that could change the endpoint authority', () => {
    expect(() =>
      validateReleaseInputs({
        env: {
          R2_ACCESS_KEY_ID: 'set',
          R2_ACCOUNT_ID: 'example.invalid/path?account=',
          R2_SECRET_ACCESS_KEY: 'set',
        },
        phase: 'upload',
        platform: 'desktop',
      }),
    ).toThrow(RE_INVALID_ACCOUNT);
  });
});
