import ssri from 'ssri';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog';

const descriptors = Object.values(CATALOG);
const HTTPS = /^https:\/\//;

describe('CATALOG', () => {
  it('declares a verifiable baked artifact for every baked platform entry', () => {
    for (const descriptor of descriptors) {
      for (const source of Object.values(descriptor.artifacts)) {
        if (source.kind !== 'baked') continue;
        expect(source.url).toMatch(HTTPS);
        expect(source.size).toBeGreaterThan(0);
        expect(Object.keys(ssri.parse(source.integrity))).not.toHaveLength(0);
      }
    }
  });

  it('gives windows entries .exe members and posix entries bare members', () => {
    for (const descriptor of descriptors) {
      for (const [key, source] of Object.entries(descriptor.artifacts)) {
        expect(source.member.endsWith('.exe')).toBe(key.startsWith('win32'));
      }
    }
  });

  it('addresses codex through the real @openai/codex packument with platform version keys', () => {
    const codex = CATALOG['agent:codex'];
    const darwin = codex.artifacts['darwin-arm64'];
    if (darwin?.kind !== 'npm') throw new Error('expected npm source');
    expect(darwin.packageName).toBe('@openai/codex');
    expect(darwin.versionKey?.('0.140.0')).toBe('0.140.0-darwin-arm64');
    expect(darwin.member).toBe('package/vendor/aarch64-apple-darwin/bin/codex');
  });

  it('names opencode platform packages with windows, not win32', () => {
    const source = CATALOG['agent:opencode'].artifacts['win32-x64'];
    if (source?.kind !== 'npm') throw new Error('expected npm source');
    expect(source.packageName).toBe('opencode-windows-x64');
  });

  it('covers the agent grid on all six platforms and tectonic everywhere but arm64 windows', () => {
    expect(Object.keys(CATALOG['agent:claude-code'].artifacts)).toHaveLength(6);
    expect(Object.keys(CATALOG['agent:codex'].artifacts)).toHaveLength(6);
    expect(Object.keys(CATALOG['agent:opencode'].artifacts)).toHaveLength(6);
    expect(CATALOG['tool:tectonic'].artifacts['win32-arm64']).toBeUndefined();
    expect(Object.keys(CATALOG['tool:tectonic'].artifacts)).toHaveLength(5);
    expect(CATALOG['tool:aigateway'].artifacts['win32-arm64']).toBeUndefined();
    expect(Object.keys(CATALOG['tool:aigateway'].artifacts)).toHaveLength(5);
  });
});
