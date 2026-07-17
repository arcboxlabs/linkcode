import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executableSearchLocations } from '../executable-locations';

describe('executableSearchLocations', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('scans absolute PATH entries in order, ahead of the fallback locations', () => {
    vi.stubEnv('PATH', '');
    const fallback = executableSearchLocations('tool');

    const dirA = join(tmpdir(), 'exec-path-a');
    const dirB = join(tmpdir(), 'exec-path-b');
    // Relative, empty, and duplicate entries must be dropped; quotes stripped.
    vi.stubEnv('PATH', [dirA, 'relative/bin', '', `"${dirB}"`, dirA].join(delimiter));
    expect(executableSearchLocations('tool')).toEqual([
      join(dirA, 'tool'),
      join(dirB, 'tool'),
      ...fallback,
    ]);
  });

  it('dedupes duplicates across PATH and the fallback locations', () => {
    vi.stubEnv('PATH', ['/usr/local/bin', '/usr/local/bin'].join(delimiter));
    const locations = executableSearchLocations('tool');
    expect(locations[0]).toBe(join('/usr/local/bin', 'tool'));
    expect(new Set(locations).size).toBe(locations.length);
  });

  it('yields only absolute candidate paths', () => {
    vi.stubEnv('PATH', ['relative/bin', ''].join(delimiter));
    for (const location of executableSearchLocations('tool')) {
      expect(isAbsolute(location)).toBe(true);
    }
  });
});
