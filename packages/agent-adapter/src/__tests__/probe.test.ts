import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.unstubAllEnvs();
});

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
    vi.stubEnv('LINKCODE_AGENT_BIN_DIR', '');

    const prober = proberAt(dir);
    await expect(prober.probe()).resolves.toEqual({
      'claude-code': { path: claude, version: '9.9.9' },
      codex: { path: codex, version: '8.8.8' },
    });
    expect(prober.resolveBinary('claude-code')).toBe(claude);
    expect(prober.resolveBinary('codex')).toBe(codex);
  });

  it('prefers the bundled binary over a detected one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    fakeCli(dir, 'claude', '9.9.9 (Claude Code)');
    const bundledDir = mkdtempSync(join(tmpdir(), 'agent-bin-'));
    mkdirSync(join(bundledDir, 'claude-code'), { recursive: true });
    const bundled = fakeCli(join(bundledDir, 'claude-code'), 'claude', '1.1.1 (Claude Code)');
    vi.stubEnv('LINKCODE_AGENT_BIN_DIR', bundledDir);

    const prober = proberAt(dir);
    await prober.probe();
    expect(prober.resolveBinary('claude-code')).toBe(bundled);
  });

  it('resolves undefined when nothing is bundled or detected', async () => {
    vi.stubEnv('LINKCODE_AGENT_BIN_DIR', '');
    const prober = new AgentRuntimeProber([new ClaudeCodeProbe([])]);
    await prober.probe();
    expect(prober.resolveBinary('claude-code')).toBeUndefined();
  });
});

describe('AgentRuntimeProber.collect', () => {
  it('reports bundled > detected > sdk sources plus builtin pi', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const claude = fakeCli(dir, 'claude', '9.9.9 (Claude Code)');
    vi.stubEnv('LINKCODE_AGENT_BIN_DIR', '');

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

  it('reports the bundled binary with its probed version', async () => {
    const bundledDir = mkdtempSync(join(tmpdir(), 'agent-bin-'));
    mkdirSync(join(bundledDir, 'claude-code'), { recursive: true });
    const bundled = fakeCli(join(bundledDir, 'claude-code'), 'claude', '1.1.1 (Claude Code)');
    vi.stubEnv('LINKCODE_AGENT_BIN_DIR', bundledDir);

    const runtimes = await new AgentRuntimeProber([new ClaudeCodeProbe([])]).collect();
    expect(runtimes['claude-code']).toEqual({
      status: 'available',
      source: 'bundled',
      path: bundled,
      version: '1.1.1',
    });
  });
});
