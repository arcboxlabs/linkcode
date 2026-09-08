import type { ManagedAssetId } from '@linkcode/schema';
import {
  ManagedAgentAssetNameSchema,
  ManagedToolAssetNameSchema,
  managedAgentAssetId,
  managedAssetKey,
  managedToolAssetId,
} from '@linkcode/schema';
import ssri from 'ssri';
import { describe, expect, it } from 'vitest';
import type { BinaryAssetDescriptor } from '../catalog';
import { CATALOG, descriptorFor, isClosureDescriptor } from '../catalog';
import { PI_CLOSURE } from '../pi-closure.gen';

const descriptors = CATALOG.filter(
  (descriptor): descriptor is BinaryAssetDescriptor => !isClosureDescriptor(descriptor),
);
const HTTPS = /^https:\/\//;
const WIN32_CODEX_BIN_RE = /\/bin\/codex\.exe$/;
const CLAUDE_CODE_ID = managedAgentAssetId('claude-code');
const CODEX_ID = managedAgentAssetId('codex');
const OPENCODE_ID = managedAgentAssetId('opencode');
const PI_ID = managedAgentAssetId('pi');
const AIGATEWAY_ID = managedToolAssetId('aigateway');
const TECTONIC_ID = managedToolAssetId('tectonic');

function binary(id: ManagedAssetId): BinaryAssetDescriptor {
  const descriptor = descriptorFor(id);
  if (isClosureDescriptor(descriptor)) {
    throw new Error(`expected a binary descriptor: ${id.kind}:${id.name}`);
  }
  return descriptor;
}

describe('CATALOG', () => {
  it('contains every managed asset identity exactly once', () => {
    const expected = [
      ...ManagedAgentAssetNameSchema.options.map((name) =>
        managedAssetKey(managedAgentAssetId(name)),
      ),
      ...ManagedToolAssetNameSchema.options.map((name) =>
        managedAssetKey(managedToolAssetId(name)),
      ),
    ];
    const actual = CATALOG.map((descriptor) => managedAssetKey(descriptor.id));

    expect(new Set(actual).size).toBe(actual.length);
    expect(new Set(actual)).toEqual(new Set(expected));
  });

  it('declares a verifiable baked artifact for every baked platform entry', () => {
    for (let i = 0, len = descriptors.length; i < len; i++) {
      const descriptor = descriptors[i];
      const sources = Object.values(descriptor.artifacts);
      for (let j = 0, sourceCount = sources.length; j < sourceCount; j++) {
        const source = sources[j];
        if (source.kind !== 'baked') continue;
        expect(source.url).toMatch(HTTPS);
        expect(source.size).toBeGreaterThan(0);
        expect(Object.keys(ssri.parse(source.integrity))).not.toHaveLength(0);
      }
    }
  });

  it('gives windows entries .exe members and posix entries bare members', () => {
    for (let i = 0, len = descriptors.length; i < len; i++) {
      const descriptor = descriptors[i];
      const artifactEntries = Object.entries(descriptor.artifacts);
      for (let j = 0, entryCount = artifactEntries.length; j < entryCount; j++) {
        const [key, source] = artifactEntries[j];
        expect(source.member.endsWith('.exe')).toBe(key.startsWith('win32'));
      }
    }
  });

  it('addresses codex through the real @openai/codex packument with platform version keys', () => {
    const codex = binary(CODEX_ID);
    const darwin = codex.artifacts['darwin-arm64'];
    if (darwin?.kind !== 'npm') throw new Error('expected npm source');
    expect(darwin.packageName).toBe('@openai/codex');
    expect(darwin.versionKey?.('0.140.0')).toBe('0.140.0-darwin-arm64');
    expect(darwin.member).toBe('package/vendor/aarch64-apple-darwin/bin/codex');
  });

  it('ships the codex Windows sandbox helpers next to the win32 binaries only', () => {
    const codexArtifacts = Object.entries(binary(CODEX_ID).artifacts);
    for (let i = 0, len = codexArtifacts.length; i < len; i++) {
      const [key, source] = codexArtifacts[i];
      if (source.kind !== 'npm') throw new Error('expected npm source');
      if (!key.startsWith('win32')) {
        expect(source.extraMembers).toBeUndefined();
        continue;
      }
      const vendorDir = source.member.replace(WIN32_CODEX_BIN_RE, '');
      expect(source.extraMembers).toEqual([
        `${vendorDir}/codex-resources/codex-windows-sandbox-setup.exe`,
        `${vendorDir}/codex-resources/codex-command-runner.exe`,
      ]);
    }
  });

  it('names opencode platform packages with windows, not win32', () => {
    const source = binary(OPENCODE_ID).artifacts['win32-x64'];
    if (source?.kind !== 'npm') throw new Error('expected npm source');
    expect(source.packageName).toBe('opencode-windows-x64');
  });

  it('registers pi as the committed closure manifest behind its SDK pin (CODE-219)', () => {
    const pi = descriptorFor(PI_ID);
    if (!isClosureDescriptor(pi)) throw new Error('expected a closure descriptor');
    expect(pi.closure).toBe(PI_CLOSURE);
    expect(pi.version).toEqual({
      kind: 'sdk-version',
      package: '@earendil-works/pi-coding-agent',
    });
  });

  it('covers the agent grid on all six platforms and tectonic everywhere but arm64 windows', () => {
    expect(Object.keys(binary(CLAUDE_CODE_ID).artifacts)).toHaveLength(6);
    expect(Object.keys(binary(CODEX_ID).artifacts)).toHaveLength(6);
    expect(Object.keys(binary(OPENCODE_ID).artifacts)).toHaveLength(6);
    expect(binary(TECTONIC_ID).artifacts['win32-arm64']).toBeUndefined();
    expect(Object.keys(binary(TECTONIC_ID).artifacts)).toHaveLength(5);
    expect(binary(AIGATEWAY_ID).artifacts['win32-arm64']).toBeUndefined();
    expect(Object.keys(binary(AIGATEWAY_ID).artifacts)).toHaveLength(5);
  });
});
