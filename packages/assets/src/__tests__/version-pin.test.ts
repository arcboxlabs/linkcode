import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../catalog';
import { wantedVersion } from '../version-pin';

const SEMVER = /^\d+\.\d+\.\d+/;

/** A fake package tree plus a `from` anchor file inside it. */
function fixture(pkg: string, manifest: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'version-pin-'));
  const dir = join(root, 'node_modules', pkg);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  const anchor = join(root, 'anchor.js');
  writeFileSync(anchor, '');
  return anchor;
}

describe('wantedVersion', () => {
  it('returns pinned versions as-is', () => {
    expect(wantedVersion({ kind: 'pinned', version: '0.16.9' })).toBe('0.16.9');
  });

  it('reads the installed SDK version', () => {
    const from = fixture('fake-sdk', { name: 'fake-sdk', version: '1.2.3' });
    expect(wantedVersion({ kind: 'sdk-version', package: 'fake-sdk' }, from)).toBe('1.2.3');
  });

  it('reads an exact dependency pin, resolving scoped packages', () => {
    const from = fixture('@scope/sdk', {
      name: '@scope/sdk',
      version: '9.9.9',
      dependencies: { '@scope/cli': '0.140.0' },
    });
    expect(
      wantedVersion(
        { kind: 'sdk-dependency', package: '@scope/sdk', dependency: '@scope/cli' },
        from,
      ),
    ).toBe('0.140.0');
  });

  it('rejects range pins — a pair install needs an exact version', () => {
    const from = fixture('fake-sdk', {
      name: 'fake-sdk',
      version: '1.2.3',
      dependencies: { cli: '^2.0.0' },
    });
    expect(
      wantedVersion({ kind: 'sdk-dependency', package: 'fake-sdk', dependency: 'cli' }, from),
    ).toBeUndefined();
  });

  it('returns undefined when the SDK is not installed', () => {
    const from = fixture('other', { name: 'other', version: '1.0.0' });
    expect(wantedVersion({ kind: 'sdk-version', package: 'absent-sdk' }, from)).toBeUndefined();
  });

  it('pins every agent asset from the SDKs installed in this repo', () => {
    expect(wantedVersion(CATALOG['agent:claude-code'].version)).toMatch(SEMVER);
    expect(wantedVersion(CATALOG['agent:codex'].version)).toMatch(SEMVER);
    expect(wantedVersion(CATALOG['agent:opencode'].version)).toMatch(SEMVER);
  });
});
