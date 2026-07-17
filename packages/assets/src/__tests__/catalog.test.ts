import ssri from 'ssri';
import { describe, expect, it } from 'vitest';
import type { BinaryAssetDescriptor } from '../catalog';
import { CATALOG, isClosureDescriptor } from '../catalog';
import { PI_CLOSURE } from '../pi-closure.gen';

const descriptors = Object.values(CATALOG).filter(
  (descriptor): descriptor is BinaryAssetDescriptor => !isClosureDescriptor(descriptor),
);
const HTTPS = /^https:\/\//;

function binary(id: keyof typeof CATALOG): BinaryAssetDescriptor {
  const descriptor = CATALOG[id];
  if (isClosureDescriptor(descriptor)) throw new Error(`expected a binary descriptor: ${id}`);
  return descriptor;
}

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
    const codex = binary('agent:codex');
    const darwin = codex.artifacts['darwin-arm64'];
    if (darwin?.kind !== 'npm') throw new Error('expected npm source');
    expect(darwin.packageName).toBe('@openai/codex');
    expect(darwin.versionKey?.('0.140.0')).toBe('0.140.0-darwin-arm64');
    expect(darwin.member).toBe('package/vendor/aarch64-apple-darwin/bin/codex');
  });

  it('ships the codex Windows sandbox helpers next to the win32 binaries only', () => {
    for (const [key, source] of Object.entries(binary('agent:codex').artifacts)) {
      if (source.kind !== 'npm') throw new Error('expected npm source');
      if (!key.startsWith('win32')) {
        expect(source.extraMembers).toBeUndefined();
        continue;
      }
      const vendorDir = source.member.replace(/\/bin\/codex\.exe$/, '');
      expect(source.extraMembers).toEqual([
        `${vendorDir}/codex-resources/codex-windows-sandbox-setup.exe`,
        `${vendorDir}/codex-resources/codex-command-runner.exe`,
      ]);
    }
  });

  it('names opencode platform packages with windows, not win32', () => {
    const source = binary('agent:opencode').artifacts['win32-x64'];
    if (source?.kind !== 'npm') throw new Error('expected npm source');
    expect(source.packageName).toBe('opencode-windows-x64');
  });

  it('registers pi as the committed closure manifest behind its SDK pin (CODE-219)', () => {
    const pi = CATALOG['agent:pi'];
    if (!isClosureDescriptor(pi)) throw new Error('expected a closure descriptor');
    expect(pi.closure).toBe(PI_CLOSURE);
    expect(pi.version).toEqual({
      kind: 'sdk-version',
      package: '@earendil-works/pi-coding-agent',
    });
  });

  it('covers the agent grid on all six platforms and tectonic everywhere but arm64 windows', () => {
    expect(Object.keys(binary('agent:claude-code').artifacts)).toHaveLength(6);
    expect(Object.keys(binary('agent:codex').artifacts)).toHaveLength(6);
    expect(Object.keys(binary('agent:opencode').artifacts)).toHaveLength(6);
    expect(binary('tool:tectonic').artifacts['win32-arm64']).toBeUndefined();
    expect(Object.keys(binary('tool:tectonic').artifacts)).toHaveLength(5);
    expect(binary('tool:aigateway').artifacts['win32-arm64']).toBeUndefined();
    expect(Object.keys(binary('tool:aigateway').artifacts)).toHaveLength(5);
  });
});
