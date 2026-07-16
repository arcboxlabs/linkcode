import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssetManager } from '@linkcode/assets';
import type { AgentRuntimes } from '@linkcode/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentsToRefresh, consentedManagedAgents } from '../managed-agent-refresh';

afterEach(() => {
  vi.unstubAllEnvs();
});

function freshStore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'refresh-store-'));
  vi.stubEnv('LINKCODE_ASSETS_DIR', dir);
  return dir;
}

/** Seed a prior managed install: any version dir under `<store>/agent/<kind>/`. */
function seedInstall(store: string, kind: string, version: string): void {
  mkdirSync(join(store, 'agent', kind, version), { recursive: true });
}

const MISSING: AgentRuntimes = {
  'claude-code': { status: 'missing' },
  codex: { status: 'missing' },
};

describe('boot managed-agent refresh (CODE-221)', () => {
  it('never downloads unprompted: a fresh store yields no consent and no refresh', () => {
    freshStore();
    const consented = consentedManagedAgents(new AssetManager());
    expect(consented).toEqual([]);
    expect(agentsToRefresh(consented, MISSING)).toEqual([]);
  });

  it('a prior install of any version is consent, and only unavailable agents refresh', () => {
    const store = freshStore();
    seedInstall(store, 'claude-code', '0.0.1');
    const consented = consentedManagedAgents(new AssetManager());
    expect(consented).toEqual(['claude-code']);

    expect(agentsToRefresh(consented, MISSING)).toEqual(['claude-code']);
    const detected: AgentRuntimes = {
      'claude-code': { status: 'available', source: 'detected', path: '/usr/local/bin/claude' },
    };
    expect(agentsToRefresh(consented, detected)).toEqual([]);
  });

  it('consent survives gcAtBoot while the replacement is not installed (offline refresh failure)', () => {
    const store = freshStore();
    seedInstall(store, 'codex', '0.0.1');
    const assets = new AssetManager();
    const consented = consentedManagedAgents(assets);
    assets.gcAtBoot();
    expect(consented).toEqual(['codex']);
    // GC keeps the superseded version until the pinned one lands, so a boot whose background
    // refresh fails still reads consent on the NEXT boot and retries.
    expect(consentedManagedAgents(assets)).toEqual(['codex']);
  });
});
