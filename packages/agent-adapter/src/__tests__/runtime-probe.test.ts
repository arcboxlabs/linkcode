import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectAgentRuntimes,
  parseClaudeVersion,
  parseCodexVersion,
  probeDetectedRuntimes,
  probeRuntimeAt,
  resolveAgentBinary,
} from '../runtime-probe';

function fakeCli(dir: string, name: string, versionLine: string): string {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\necho "${versionLine}"\n`);
  chmodSync(file, 0o755);
  return file;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  // Reset the module-level detection state so a test's fake CLIs don't leak into the next.
  await probeDetectedRuntimes(() => []);
});

describe('version parsers', () => {
  it('accepts real CLI output and rejects impostors', () => {
    expect(parseClaudeVersion('2.1.202 (Claude Code)\n')).toBe('2.1.202');
    expect(parseClaudeVersion('2.1.202')).toBeUndefined();
    expect(parseClaudeVersion('not a version')).toBeUndefined();
    expect(parseCodexVersion('codex-cli 0.142.4\n')).toBe('0.142.4');
    expect(parseCodexVersion('0.142.4')).toBeUndefined();
  });
});

describe('probeRuntimeAt', () => {
  it('returns path+version for a marker-verified binary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-probe-'));
    const file = fakeCli(dir, 'claude', '9.9.9 (Claude Code)');
    await expect(probeRuntimeAt(file, parseClaudeVersion)).resolves.toEqual({
      path: file,
      version: '9.9.9',
    });
  });

  it('rejects a binary whose --version lacks the vendor marker', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-probe-'));
    const file = fakeCli(dir, 'claude', 'totally-not-claude 1.0.0');
    await expect(probeRuntimeAt(file, parseClaudeVersion)).resolves.toBeUndefined();
  });

  it('returns undefined for a missing file', async () => {
    await expect(
      probeRuntimeAt('/nonexistent/claude', parseClaudeVersion),
    ).resolves.toBeUndefined();
  });
});

describe('probeDetectedRuntimes / resolveAgentBinary', () => {
  it('detects per kind from the first verified location and resolves through it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-probe-'));
    const claude = fakeCli(dir, 'claude', '9.9.9 (Claude Code)');
    const codex = fakeCli(dir, 'codex', 'codex-cli 8.8.8');
    vi.stubEnv('LINKCODE_AGENT_BIN_DIR', '');

    const detected = await probeDetectedRuntimes((binary) => [join(dir, binary)]);
    expect(detected).toEqual({
      'claude-code': { path: claude, version: '9.9.9' },
      codex: { path: codex, version: '8.8.8' },
    });
    expect(resolveAgentBinary('claude-code')).toBe(claude);
    expect(resolveAgentBinary('codex')).toBe(codex);
  });

  it('prefers the bundled binary over a detected one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-probe-'));
    fakeCli(dir, 'claude', '9.9.9 (Claude Code)');
    const bundledDir = mkdtempSync(join(tmpdir(), 'agent-bin-'));
    mkdirSync(join(bundledDir, 'claude-code'), { recursive: true });
    const bundled = fakeCli(join(bundledDir, 'claude-code'), 'claude', '1.1.1 (Claude Code)');
    vi.stubEnv('LINKCODE_AGENT_BIN_DIR', bundledDir);

    await probeDetectedRuntimes((binary) => [join(dir, binary)]);
    expect(resolveAgentBinary('claude-code')).toBe(bundled);
  });

  it('resolves undefined when nothing is bundled or detected', async () => {
    vi.stubEnv('LINKCODE_AGENT_BIN_DIR', '');
    await probeDetectedRuntimes(() => []);
    expect(resolveAgentBinary('claude-code')).toBeUndefined();
  });
});

describe('collectAgentRuntimes', () => {
  it('reports bundled > detected > sdk sources plus builtin pi', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-probe-'));
    const claude = fakeCli(dir, 'claude', '9.9.9 (Claude Code)');
    vi.stubEnv('LINKCODE_AGENT_BIN_DIR', '');

    const runtimes = await collectAgentRuntimes((binary) => [join(dir, binary)]);
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

    const runtimes = await collectAgentRuntimes(() => []);
    expect(runtimes['claude-code']).toEqual({
      status: 'available',
      source: 'bundled',
      path: bundled,
      version: '1.1.1',
    });
  });
});
