import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
}));

let root: string;

beforeEach(() => {
  vi.resetModules();
  root = mkdtempSync(join(tmpdir(), 'linkcode-settings-'));
  mocks.userData = join(root, 'user-data');
  mkdirSync(mocks.userData, { recursive: true });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('desktop settings persistence', () => {
  it('leaves the history import onboarding pending on a first install', async () => {
    const settings = await import('../settings');

    expect(settings.getSettings().historyImportOnboardingHandled).toBe(false);
  });

  it('treats settings from an existing user as already handled', async () => {
    writeFileSync(join(mocks.userData, 'settings.json'), JSON.stringify({ theme: 'dark' }));
    const settings = await import('../settings');

    expect(settings.getSettings()).toMatchObject({
      theme: 'dark',
      historyImportOnboardingHandled: true,
    });
  });

  it('does not publish a new in-memory endpoint when persistence fails', async () => {
    const settings = await import('../settings');
    expect(settings.getSettings().daemonUrl).toBeNull();

    rmSync(mocks.userData, { recursive: true });
    writeFileSync(mocks.userData, 'not a directory');

    expect(() => settings.setSettings({ daemonUrl: 'http://127.0.0.1:3999' })).toThrow();
    expect(settings.getSettings().daemonUrl).toBeNull();
  });

  it('updates memory only after writing the validated settings', async () => {
    const settings = await import('../settings');
    const next = settings.setSettings({ daemonUrl: 'http://127.0.0.1:3999' });

    expect(settings.getSettings()).toBe(next);
    expect(JSON.parse(readFileSync(join(mocks.userData, 'settings.json'), 'utf8'))).toEqual(next);
  });
});
