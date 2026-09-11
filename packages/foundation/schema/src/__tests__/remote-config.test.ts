import { describe, expect, it } from 'vitest';
import { AgentKindSchema } from '../model/primitives';
import { ConfigBuildBundleSchema } from '../remote-config';

// Schema-level fixture only: this file validates shape/consistency of ConfigBuildBundleSchema in
// isolation, not the snapshot-hash cross-checks that live in @linkcode/common's assertConfigBuildBundle.
function validBundle(): Record<string, unknown> {
  return {
    brandId: 'linkcode',
    buildBundleVersion: 1,
    channel: 'stable',
    endpoints: {
      emergency: null,
      normal: null,
      telemetry: 'https://telemetry.example.invalid/linkcode',
    },
    keyrings: { emergency: {}, normal: {} },
    maximumSchemaVersion: 1,
    platform: 'desktop',
    provenance: {
      configRevisionId: 'rev-1',
      configVersion: '1',
      generatedAt: '2026-08-24T00:00:00Z',
      schemaVersion: 1,
      sourceGitSha: 'a'.repeat(40),
    },
    snapshot: {
      base64Url: 'AAAA',
      sha256: '0'.repeat(64),
      sizeBytes: 4,
    },
  };
}

describe('ConfigBuildBundleSchema agents/services', () => {
  it('accepts a bundle with neither field (absent = unrestricted)', () => {
    const result = ConfigBuildBundleSchema.parse(validBundle());
    expect(result.agents).toBeUndefined();
    expect(result.services).toBeUndefined();
  });

  it('accepts declared agents and services', () => {
    const result = ConfigBuildBundleSchema.parse({
      ...validBundle(),
      agents: ['pi'],
      services: ['linkcode-gateway'],
    });
    expect(result.agents).toEqual(['pi']);
    expect(result.services).toEqual(['linkcode-gateway']);
  });

  it('rejects an empty agents or services array', () => {
    expect(() => ConfigBuildBundleSchema.parse({ ...validBundle(), agents: [] })).toThrow();
    expect(() => ConfigBuildBundleSchema.parse({ ...validBundle(), services: [] })).toThrow();
  });

  it('rejects an unknown agent kind', () => {
    expect(() =>
      ConfigBuildBundleSchema.parse({ ...validBundle(), agents: ['not-a-kind'] }),
    ).toThrow();
  });

  it('rejects a malformed service id', () => {
    expect(() =>
      ConfigBuildBundleSchema.parse({ ...validBundle(), services: ['Not_Valid'] }),
    ).toThrow();
  });

  it('rejects duplicates in either array', () => {
    expect(() => ConfigBuildBundleSchema.parse({ ...validBundle(), agents: ['pi', 'pi'] })).toThrow(
      'duplicates',
    );
    expect(() =>
      ConfigBuildBundleSchema.parse({
        ...validBundle(),
        services: ['linkcode-gateway', 'linkcode-gateway'],
      }),
    ).toThrow('duplicates');
  });

  it('still fails closed on unknown top-level fields (regression)', () => {
    expect(() => ConfigBuildBundleSchema.parse({ ...validBundle(), extra: 1 })).toThrow();
  });

  // remote-config.ts hand-duplicates the agent-kind list (its bare-import-only shape keeps it
  // loadable from build scripts under plain Node ESM); this pins the copy to the real enum.
  it('accepts every AgentKindSchema kind, catching hand-duplicated list drift', () => {
    const result = ConfigBuildBundleSchema.parse({
      ...validBundle(),
      agents: AgentKindSchema.options,
    });
    expect(result.agents).toEqual(AgentKindSchema.options);
  });
});
