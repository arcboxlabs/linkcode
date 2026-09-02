import { describe, expect, it } from 'vitest';
import inputsModule from './release-inputs.cjs';

const { validateReleaseInputs } = inputsModule;
const RE_RENDER_MISSING =
  /var CONFIG_PUBLISHER_REPO.*var CONFIG_SOURCE_REPO.*var CONFIG_RELEASE_KEYRINGS.*var CONFIG_RELEASE_REVISION/;
const RE_MOBILE_SIGNING =
  /secret EXPO_TOKEN.*secret POSTHOG_PROJECT_TOKEN.*var POSTHOG_HOST.*secret SENTRY_AUTH_TOKEN.*secret SENTRY_DSN_MOBILE/;
const RE_DESKTOP_UPLOAD = /R2_ACCESS_KEY_ID.*R2_ACCOUNT_ID.*R2_SECRET_ACCESS_KEY/;
const RE_INVALID_KEY = /must encode an App Store Connect \.p8 key/;
const RE_INVALID_ACCOUNT = /must be a lowercase 32-hex Cloudflare account ID/;
const RE_CANONICAL_REPOSITORY = /must use canonical owner\/repository syntax/;
const RE_ARCBOXLABS_OWNER = /owner must be arcboxlabs/;
const RE_SOURCE_CANONICAL_REPOSITORY =
  /CONFIG_SOURCE_REPO must use canonical owner\/repository syntax/;
const RE_SOURCE_ARCBOXLABS_OWNER = /CONFIG_SOURCE_REPO owner must be arcboxlabs/;
const RE_DIFFERENT_REPOSITORIES = /must identify different repositories/;

describe('validateReleaseInputs', () => {
  it('reports absent render vars by exact GitHub name', () => {
    expect(() => validateReleaseInputs({ env: {}, phase: 'render', platform: 'desktop' })).toThrow(
      RE_RENDER_MISSING,
    );
  });

  it('rejects malformed and cross-organization config repositories', () => {
    const renderEnv = {
      CONFIG_PUBLISHER_REPO: 'arcboxlabs/config-publisher',
      CONFIG_SOURCE_REPO: 'arcboxlabs/config-source',
      CONFIG_RELEASE_KEYRINGS: '{}',
      CONFIG_RELEASE_REVISION: '{}',
    };
    expect(() =>
      validateReleaseInputs({
        env: {
          ...renderEnv,
          CONFIG_PUBLISHER_REPO: 'https://github.com/arcboxlabs/publisher',
        },
        phase: 'render',
        platform: 'desktop',
      }),
    ).toThrow(RE_CANONICAL_REPOSITORY);
    expect(() =>
      validateReleaseInputs({
        env: { ...renderEnv, CONFIG_PUBLISHER_REPO: 'another-org/config-publisher' },
        phase: 'render',
        platform: 'desktop',
      }),
    ).toThrow(RE_ARCBOXLABS_OWNER);
    expect(() =>
      validateReleaseInputs({
        env: { ...renderEnv, CONFIG_SOURCE_REPO: 'arcboxlabs/source/extra' },
        phase: 'render',
        platform: 'desktop',
      }),
    ).toThrow(RE_SOURCE_CANONICAL_REPOSITORY);
    expect(() =>
      validateReleaseInputs({
        env: { ...renderEnv, CONFIG_SOURCE_REPO: 'another-org/config-source' },
        phase: 'render',
        platform: 'desktop',
      }),
    ).toThrow(RE_SOURCE_ARCBOXLABS_OWNER);
  });

  it('accepts non-hardcoded publisher and source repositories in the ArcBox Labs organization', () => {
    expect(() =>
      validateReleaseInputs({
        env: {
          CONFIG_PUBLISHER_REPO: 'arcboxlabs/config-publisher',
          CONFIG_SOURCE_REPO: 'arcboxlabs/config-source',
          CONFIG_RELEASE_KEYRINGS: '{}',
          CONFIG_RELEASE_REVISION: '{}',
        },
        phase: 'render',
        platform: 'desktop',
      }),
    ).not.toThrow();
  });

  it('rejects equal publisher and source repository roles', () => {
    expect(() =>
      validateReleaseInputs({
        env: {
          CONFIG_PUBLISHER_REPO: 'arcboxlabs/config-repository',
          CONFIG_SOURCE_REPO: 'arcboxlabs/config-repository',
          CONFIG_RELEASE_KEYRINGS: '{}',
          CONFIG_RELEASE_REVISION: '{}',
        },
        phase: 'render',
        platform: 'desktop',
      }),
    ).toThrow(RE_DIFFERENT_REPOSITORIES);
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
    const env = [
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
    ].reduce((acc, name) => {
      acc[name] = 'set';
      return acc;
    }, {});
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
