import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorCandidate } from '../editors';
import { editorTargets, isLaunchable } from '../editors';

const CURSOR: EditorCandidate = {
  id: 'cursor',
  label: 'Cursor',
  cli: 'cursor',
  macApp: 'Cursor.app',
  windowsExe: join('cursor', 'Cursor.exe'),
};

describe('editorTargets', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('probes the CLI ahead of the app bundle on macOS', () => {
    vi.stubEnv('PATH', '/usr/local/bin');
    const targets = editorTargets(CURSOR, 'darwin');

    expect(targets[0]).toEqual({ kind: 'executable', file: '/usr/local/bin/cursor' });
    expect(targets).toContainEqual({
      kind: 'mac-app',
      bundle: '/Applications/Cursor.app',
      label: 'Cursor',
    });
    expect(targets).toContainEqual({
      kind: 'mac-app',
      bundle: join(homedir(), 'Applications', 'Cursor.app'),
      label: 'Cursor',
    });
  });

  it('offers no app bundle off macOS', () => {
    vi.stubEnv('PATH', '/usr/bin');
    expect(editorTargets(CURSOR, 'linux').every((target) => target.kind === 'executable')).toBe(
      true,
    );
  });

  // The Windows editor CLIs are `.cmd` shims that spawn cannot exec without a shell, so Windows
  // resolves through installed executables only.
  it('skips the PATH scan on Windows and probes the program roots', () => {
    const localAppData = String.raw`C:\Users\dev\AppData\Local`;
    const programFiles = String.raw`C:\Program Files`;
    vi.stubEnv('PATH', [String.raw`C:\bin`, String.raw`C:\other`].join(delimiter));
    vi.stubEnv('LOCALAPPDATA', localAppData);
    vi.stubEnv('ProgramFiles', programFiles);

    expect(editorTargets(CURSOR, 'win32')).toEqual([
      { kind: 'executable', file: join(localAppData, 'Programs', 'cursor', 'Cursor.exe') },
      { kind: 'executable', file: join(programFiles, 'cursor', 'Cursor.exe') },
    ]);
  });

  it('yields nothing for an editor with no target on the platform', () => {
    expect(editorTargets({ id: 'x', label: 'X' }, 'darwin')).toEqual([]);
  });

  // JetBrains entries carry no windowsExe by design, so Windows detection is a no-op for them.
  it('yields nothing on Windows for a cli-and-bundle-only editor', () => {
    vi.stubEnv('PATH', String.raw`C:\bin`);
    vi.stubEnv('LOCALAPPDATA', String.raw`C:\Users\dev\AppData\Local`);
    const jetBrainsShaped = {
      id: 'webstorm',
      label: 'WebStorm',
      cli: 'webstorm',
      macApp: 'WebStorm.app',
    };
    expect(editorTargets(jetBrainsShaped, 'win32')).toEqual([]);
  });
});

describe('isLaunchable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'linkcode-editors-'));

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Resolution takes the first launchable target, so a present-but-not-executable file must not
  // outrank an application bundle further down the list.
  it('rejects an existing file that is not executable', () => {
    const file = join(dir, 'not-executable');
    writeFileSync(file, '');
    chmodSync(file, 0o644);
    expect(isLaunchable({ kind: 'executable', file })).toBe(false);

    chmodSync(file, 0o755);
    expect(isLaunchable({ kind: 'executable', file })).toBe(true);
  });

  it('rejects a missing target of either kind', () => {
    const missing = join(dir, 'absent');
    expect(isLaunchable({ kind: 'executable', file: missing })).toBe(false);
    expect(isLaunchable({ kind: 'mac-app', bundle: missing, label: 'X' })).toBe(false);
  });
});
