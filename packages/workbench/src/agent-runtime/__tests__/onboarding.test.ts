import type { AgentRuntimes, ManagedAssetStatus } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { deriveAgentRuntimeCues } from '../onboarding';

const ASSETS: ManagedAssetStatus[] = [
  { id: 'agent:claude-code', wantedVersion: '0.3.179' },
  { id: 'agent:codex', wantedVersion: '0.140.0' },
  { id: 'tool:tectonic', wantedVersion: '0.16.9' },
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
    const pinless: ManagedAssetStatus[] = [{ id: 'agent:claude-code' }];
    expect(deriveAgentRuntimeCues(runtimes, pinless, {}, {})).toEqual({
      'claude-code': { state: 'missing', downloadable: false },
    });
    // Assets still loading — optimistic; a pinless ensure would fail into the failed cue.
    expect(deriveAgentRuntimeCues(runtimes, undefined, {}, {})).toEqual({
      'claude-code': { state: 'missing', downloadable: true },
    });
  });

  it('is not downloadable for a kind with no backing asset', () => {
    const runtimes: AgentRuntimes = { pi: { status: 'missing' } };
    expect(deriveAgentRuntimeCues(runtimes, ASSETS, {}, {})).toEqual({
      pi: { state: 'missing', downloadable: false },
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
});
