import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRuntimeProber, ClaudeCodeProbe, CodexProbe } from '../probe';

function fakeCli(dir: string, name: string, versionLine: string): string {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\necho "${versionLine}"\n`);
  chmodSync(file, 0o755);
  return file;
}

function proberAt(dir: string): AgentRuntimeProber {
  return new AgentRuntimeProber([
    new ClaudeCodeProbe([join(dir, 'claude')]),
    new CodexProbe([join(dir, 'codex')]),
  ]);
}

describe('version parsers', () => {
  it('accepts real CLI output and rejects impostors', () => {
    const claude = new ClaudeCodeProbe();
    const codex = new CodexProbe();
    expect(claude.parseVersion('2.1.202 (Claude Code)\n')).toBe('2.1.202');
    expect(claude.parseVersion('2.1.202')).toBeUndefined();
    expect(claude.parseVersion('not a version')).toBeUndefined();
    expect(codex.parseVersion('codex-cli 0.142.4\n')).toBe('0.142.4');
    expect(codex.parseVersion('0.142.4')).toBeUndefined();
  });
});

describe('AgentCliProbe.probeAt', () => {
  it('returns path+version for a marker-verified binary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const file = fakeCli(dir, 'claude', '9.9.9 (Claude Code)');
    await expect(new ClaudeCodeProbe().probeAt(file)).resolves.toEqual({
      path: file,
      version: '9.9.9',
    });
  });

  it('rejects a binary whose --version lacks the vendor marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const file = fakeCli(dir, 'claude', 'totally-not-claude 1.0.0');
    await expect(new ClaudeCodeProbe().probeAt(file)).resolves.toBeUndefined();
  });

  it('returns undefined for a missing file', async () => {
    await expect(new ClaudeCodeProbe().probeAt('/nonexistent/claude')).resolves.toBeUndefined();
  });
});

describe('AgentCliProbe.detect', () => {
  it('walks the location precedence list and takes the first verified install', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const impostor = fakeCli(dir, 'claude-impostor', 'something else');
    const real = fakeCli(dir, 'claude', '9.9.9 (Claude Code)');
    const probe = new ClaudeCodeProbe(['/nonexistent/claude', impostor, real]);
    await expect(probe.detect()).resolves.toEqual({ path: real, version: '9.9.9' });
  });
});

describe('AgentRuntimeProber probe/resolveBinary', () => {
  it('detects per kind and resolves through the detection', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const claude = fakeCli(dir, 'claude', '9.9.9 (Claude Code)');
    const codex = fakeCli(dir, 'codex', 'codex-cli 8.8.8');

    const prober = proberAt(dir);
    await expect(prober.probe()).resolves.toEqual({
      'claude-code': { path: claude, version: '9.9.9' },
      codex: { path: codex, version: '8.8.8' },
    });
    expect(prober.resolveBinary('claude-code')).toBe(claude);
    expect(prober.resolveBinary('codex')).toBe(codex);
  });

  it('prefers a managed binary over a detected one, live as installs land', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const detected = fakeCli(dir, 'claude', '9.9.9 (Claude Code)');
    const managedDir = mkdtempSync(join(tmpdir(), 'managed-'));
    const managed = fakeCli(managedDir, 'claude', '1.1.1 (Claude Code)');

    let installed: string | undefined;
    const prober = proberAt(dir);
    prober.setManagedResolver((kind) => (kind === 'claude-code' ? installed : undefined));
    await prober.probe();
    expect(prober.resolveBinary('claude-code')).toBe(detected);
    installed = managed;
    expect(prober.resolveBinary('claude-code')).toBe(managed);
  });

  it('resolves undefined when nothing is managed or detected', async () => {
    const prober = new AgentRuntimeProber([new ClaudeCodeProbe([])]);
    await prober.probe();
    expect(prober.resolveBinary('claude-code')).toBeUndefined();
  });
});

describe('AgentRuntimeProber.collect', () => {
  it('reports managed > detected > sdk sources plus builtin pi', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const claude = fakeCli(dir, 'claude', '9.9.9 (Claude Code)');

    const runtimes = await proberAt(dir).collect();
    expect(runtimes['claude-code']).toEqual({
      status: 'available',
      source: 'detected',
      path: claude,
      version: '9.9.9',
    });
    expect(runtimes.codex).toEqual({ status: 'available', source: 'sdk' });
    expect(runtimes.pi).toEqual({ status: 'available', source: 'builtin' });
    expect(runtimes.opencode).toBeUndefined();
  });

  it('reports missing when nothing is managed, detected, or SDK-resolvable', async () => {
    class NoSdkClaudeProbe extends ClaudeCodeProbe {
      override sdkPlatformPackagePresent(): boolean {
        return false;
      }
    }
    const runtimes = await new AgentRuntimeProber([new NoSdkClaudeProbe([])]).collect();
    expect(runtimes['claude-code']).toEqual({ status: 'missing' });
  });

  it('reports a managed binary with its probed version', async () => {
    const managedDir = mkdtempSync(join(tmpdir(), 'managed-'));
    const managed = fakeCli(managedDir, 'claude', '1.1.1 (Claude Code)');

    const prober = new AgentRuntimeProber([new ClaudeCodeProbe([])]);
    prober.setManagedResolver(() => managed);
    const runtimes = await prober.collect();
    expect(runtimes['claude-code']).toEqual({
      status: 'available',
      source: 'managed',
      path: managed,
      version: '1.1.1',
    });
  });
});
