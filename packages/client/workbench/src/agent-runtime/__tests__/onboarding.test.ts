import type { AgentRuntimes, ManagedAssetStatus } from '@linkcode/schema';
import { managedAgentAssetId, managedToolAssetId } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { AssetActivityMap } from '../onboarding';
import { deriveAgentRuntimeCues, dropConfirmedInstalls } from '../onboarding';

const ASSETS: ManagedAssetStatus[] = [
  { id: managedAgentAssetId('claude-code'), wantedVersion: '0.3.179' },
  { id: managedAgentAssetId('codex'), wantedVersion: '0.140.0' },
  { id: managedToolAssetId('tectonic'), wantedVersion: '0.16.9' },
];

describe('deriveAgentRuntimeCues', () => {
  it('yields nothing while runtimes are still loading, and nothing for ready runtimes', () => {
    expect(deriveAgentRuntimeCues(undefined, ASSETS, {}, {})).toEqual({});
    const runtimes: AgentRuntimes = {
      'claude-code': { status: 'available', source: 'detected', version: '2.1.202' },
      pi: { status: 'available', source: 'builtin' },
    };
    expect(deriveAgentRuntimeCues(runtimes, ASSETS, {}, {})).toEqual({});
  });

  it('marks a missing runtime downloadable when its asset has a version pin', () => {
    const runtimes: AgentRuntimes = { 'claude-code': { status: 'missing' } };
    expect(deriveAgentRuntimeCues(runtimes, ASSETS, {}, {})).toEqual({
      'claude-code': { state: 'missing', downloadable: true },
    });
    // No pin (SDK absent on this host) — the download button would be a dead end.
    const pinless: ManagedAssetStatus[] = [{ id: managedAgentAssetId('claude-code') }];
    expect(deriveAgentRuntimeCues(runtimes, pinless, {}, {})).toEqual({
      'claude-code': { state: 'missing', downloadable: false },
    });
    // Assets still loading — optimistic; a pinless ensure would fail into the failed cue.
    expect(deriveAgentRuntimeCues(runtimes, undefined, {}, {})).toEqual({
      'claude-code': { state: 'missing', downloadable: true },
    });
  });

  it('is not downloadable for a kind with no backing asset', () => {
    const runtimes: AgentRuntimes = { 'grok-build': { status: 'missing' } };
    expect(deriveAgentRuntimeCues(runtimes, ASSETS, {}, {})).toEqual({
      'grok-build': { state: 'missing', downloadable: false },
    });
  });

  it('marks a missing pi downloadable through its closure asset (CODE-219)', () => {
    const runtimes: AgentRuntimes = { pi: { status: 'missing' } };
    const assets: ManagedAssetStatus[] = [
      ...ASSETS,
      { id: managedAgentAssetId('pi'), wantedVersion: '0.80.6' },
    ];
    expect(deriveAgentRuntimeCues(runtimes, assets, {}, {})).toEqual({
      pi: { state: 'missing', downloadable: true },
    });
  });

  it('activity overrides the probed missing status: downloading, failed, installed bridge', () => {
    const runtimes: AgentRuntimes = { 'claude-code': { status: 'missing' } };
    expect(
      deriveAgentRuntimeCues(
        runtimes,
        ASSETS,
        { 'agent:claude-code': { kind: 'downloading', receivedBytes: 42, totalBytes: 100 } },
        {},
      ),
    ).toEqual({
      'claude-code': { state: 'downloading', receivedBytes: 42, totalBytes: 100 },
    });
    expect(
      deriveAgentRuntimeCues(
        runtimes,
        ASSETS,
        { 'agent:claude-code': { kind: 'failed', error: 'network down' } },
        {},
      ),
    ).toEqual({ 'claude-code': { state: 'failed', error: 'network down' } });
    // Settled successfully but the runtime re-probe push has not landed yet: no cue, no block.
    expect(
      deriveAgentRuntimeCues(runtimes, ASSETS, { 'agent:claude-code': { kind: 'installed' } }, {}),
    ).toEqual({});
  });

  it('activity also overrides out-of-range: downloading the paired version shows progress', () => {
    const runtimes: AgentRuntimes = {
      codex: { status: 'out-of-range', source: 'detected', version: '0.99.0' },
    };
    expect(
      deriveAgentRuntimeCues(
        runtimes,
        ASSETS,
        { 'agent:codex': { kind: 'downloading', receivedBytes: 7, totalBytes: 10 } },
        {},
      ),
    ).toEqual({ codex: { state: 'downloading', receivedBytes: 7, totalBytes: 10 } });
    expect(
      deriveAgentRuntimeCues(runtimes, ASSETS, { 'agent:codex': { kind: 'installed' } }, {}),
    ).toEqual({});
    expect(
      deriveAgentRuntimeCues(
        runtimes,
        ASSETS,
        { 'agent:codex': { kind: 'failed', error: 'offline' } },
        {},
      ),
    ).toEqual({ codex: { state: 'failed', error: 'offline' } });
  });

  it('prompts for out-of-range versions until that exact version is acknowledged', () => {
    const runtimes: AgentRuntimes = {
      codex: { status: 'out-of-range', source: 'detected', version: '0.99.0' },
    };
    expect(deriveAgentRuntimeCues(runtimes, ASSETS, {}, {})).toEqual({
      codex: { state: 'unverified', version: '0.99.0' },
    });
    expect(deriveAgentRuntimeCues(runtimes, ASSETS, {}, { codex: '0.99.0' })).toEqual({});
    // A different out-of-range version prompts again (decision: remember per agent+version).
    expect(deriveAgentRuntimeCues(runtimes, ASSETS, {}, { codex: '0.98.0' })).toEqual({
      codex: { state: 'unverified', version: '0.99.0' },
    });
  });

  it('offers login for a signed-out runtime, tracking the phase from login activity', () => {
    const runtimes: AgentRuntimes = {
      'claude-code': {
        status: 'available',
        source: 'detected',
        version: '2.1.202',
        auth: { loggedIn: false },
      },
    };
    expect(deriveAgentRuntimeCues(runtimes, ASSETS, {}, {}, {})).toEqual({
      'claude-code': { state: 'needs-login', phase: 'idle' },
    });
    expect(
      deriveAgentRuntimeCues(runtimes, ASSETS, {}, {}, { 'claude-code': { kind: 'opening' } }),
    ).toEqual({ 'claude-code': { state: 'needs-login', phase: 'opening' } });
    expect(
      deriveAgentRuntimeCues(
        runtimes,
        ASSETS,
        {},
        {},
        {
          'claude-code': { kind: 'awaiting-code', url: 'https://x/oauth/authorize' },
        },
      ),
    ).toEqual({
      'claude-code': {
        state: 'needs-login',
        phase: 'awaiting-code',
        url: 'https://x/oauth/authorize',
      },
    });
    expect(
      deriveAgentRuntimeCues(
        runtimes,
        ASSETS,
        {},
        {},
        {
          'claude-code': { kind: 'failed', error: 'nope' },
        },
      ),
    ).toEqual({ 'claude-code': { state: 'needs-login', phase: 'failed', error: 'nope' } });
  });

  it('shows no login cue when signed in, and none when auth is unprobed', () => {
    const loggedIn: AgentRuntimes = {
      'claude-code': {
        status: 'available',
        source: 'detected',
        auth: { loggedIn: true, method: 'claude.ai' },
      },
    };
    expect(deriveAgentRuntimeCues(loggedIn, ASSETS, {}, {}, {})).toEqual({});
    const unprobed: AgentRuntimes = { pi: { status: 'available', source: 'builtin' } };
    expect(deriveAgentRuntimeCues(unprobed, ASSETS, {}, {}, {})).toEqual({});
  });

  it('suppresses the login cue when the agent has a configured API key', () => {
    const runtimes: AgentRuntimes = {
      'claude-code': { status: 'available', source: 'detected', auth: { loggedIn: false } },
    };
    // Signed out but a key is saved — the daemon injects it as ANTHROPIC_API_KEY, so no login needed.
    expect(
      deriveAgentRuntimeCues(
        runtimes,
        ASSETS,
        {},
        {},
        {},
        {
          'claude-code': { enabled: true, apiKey: 'sk-x' },
        },
      ),
    ).toEqual({});
    // No key configured → the login cue still shows.
    expect(deriveAgentRuntimeCues(runtimes, ASSETS, {}, {}, {})).toEqual({
      'claude-code': { state: 'needs-login', phase: 'idle' },
    });
  });
});

describe('dropConfirmedInstalls', () => {
  const activity: AssetActivityMap = {
    'agent:claude-code': { kind: 'installed' },
    'agent:codex': { kind: 'downloading', receivedBytes: 1 },
    'tool:tectonic': { kind: 'installed' },
  };

  it('drops an installed bridge only once its own agent probes available', () => {
    // The push was caused by an unrelated kind — claude-code's probe hasn't caught up yet, so
    // clearing its bridge would flash the Download card back over a settled install.
    const stale: AgentRuntimes = { 'claude-code': { status: 'missing' } };
    expect(dropConfirmedInstalls(activity, stale)).toEqual({
      'agent:claude-code': { kind: 'installed' },
      'agent:codex': { kind: 'downloading', receivedBytes: 1 },
    });

    const confirmed: AgentRuntimes = {
      'claude-code': { status: 'available', source: 'managed', version: '2.1.202' },
    };
    expect(dropConfirmedInstalls(activity, confirmed)).toEqual({
      'agent:codex': { kind: 'downloading', receivedBytes: 1 },
    });
  });

  it('never touches non-installed activity', () => {
    const downloading: AssetActivityMap = {
      'agent:codex': { kind: 'failed', error: 'network down' },
    };
    expect(dropConfirmedInstalls(downloading, {})).toEqual(downloading);
  });
});
