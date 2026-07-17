import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AgentRuntimeProber,
  ClaudeCodeProbe,
  CodexProbe,
  GrokBuildProbe,
  parseClaudeAuthStatus,
  parseCodexLoginStatus,
} from '../probe';

function fakeCli(dir: string, name: string, versionLine: string): string {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\necho "${versionLine}"\n`);
  chmodSync(file, 0o755);
  return file;
}

/** A fake `claude` that answers `auth status` with `authJson` (and exit `authExit`), else the version. */
function fakeAuthCli(dir: string, versionLine: string, authJson: string, authExit = 0): string {
  const file = join(dir, 'claude');
  writeFileSync(
    file,
    `#!/bin/sh\nif [ "$1" = "auth" ]; then echo '${authJson}'; exit ${authExit}; fi\necho "${versionLine}"\n`,
  );
  chmodSync(file, 0o755);
  return file;
}

function proberAt(dir: string): AgentRuntimeProber {
  return new AgentRuntimeProber([
    new ClaudeCodeProbe([join(dir, 'claude')]),
    new CodexProbe([join(dir, 'codex')]),
    new GrokBuildProbe([join(dir, 'grok')]),
  ]);
}

describe('version parsers', () => {
  it('accepts real CLI output and rejects impostors', () => {
    const claude = new ClaudeCodeProbe();
    const codex = new CodexProbe();
    const grok = new GrokBuildProbe();
    expect(claude.parseVersion('2.1.202 (Claude Code)\n')).toBe('2.1.202');
    expect(claude.parseVersion('2.1.202')).toBeUndefined();
    expect(claude.parseVersion('not a version')).toBeUndefined();
    expect(codex.parseVersion('codex-cli 0.142.4\n')).toBe('0.142.4');
    expect(codex.parseVersion('0.142.4')).toBeUndefined();
    expect(grok.parseVersion('grok 0.2.102 (ab5ebf69acec)\n')).toBe('0.2.102');
    expect(grok.parseVersion('0.2.102')).toBeUndefined();
  });
});

describe('parseClaudeAuthStatus', () => {
  it('extracts login fields from a signed-in payload', () => {
    expect(
      parseClaudeAuthStatus(
        '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max","email":"x@y.z","orgId":"o1"}',
      ),
    ).toEqual({ loggedIn: true, method: 'claude.ai', subscriptionType: 'max', email: 'x@y.z' });
  });

  it('preserves a signed-out status', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":false}')).toEqual({
      loggedIn: false,
      method: undefined,
      subscriptionType: undefined,
    });
  });

  it('fails open on non-JSON or a missing loggedIn field', () => {
    expect(parseClaudeAuthStatus('not json')).toBeUndefined();
    expect(parseClaudeAuthStatus('42')).toBeUndefined();
    expect(parseClaudeAuthStatus('{"email":"x@y.z"}')).toBeUndefined();
  });
});

describe('ClaudeCodeProbe.probeAuth', () => {
  it('reads a signed-in status from `auth status --json`', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const file = fakeAuthCli(
      dir,
      '9.9.9 (Claude Code)',
      '{"loggedIn":true,"authMethod":"claude.ai"}',
    );
    await expect(new ClaudeCodeProbe().probeAuth(file)).resolves.toEqual({
      loggedIn: true,
      method: 'claude.ai',
      subscriptionType: undefined,
    });
  });

  it('still reads a signed-out status when the command exits non-zero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const file = fakeAuthCli(dir, '9.9.9 (Claude Code)', '{"loggedIn":false}', 1);
    await expect(new ClaudeCodeProbe().probeAuth(file)).resolves.toEqual({
      loggedIn: false,
      method: undefined,
      subscriptionType: undefined,
    });
  });
});

describe('parseCodexLoginStatus', () => {
  it('maps the three verified wordings (codex-cli 0.144.1)', () => {
    expect(parseCodexLoginStatus('Logged in using ChatGPT\n')).toEqual({
      loggedIn: true,
      method: 'chatgpt',
    });
    expect(parseCodexLoginStatus('Logged in using an API key - ***\n')).toEqual({
      loggedIn: true,
      method: 'apikey',
    });
    expect(parseCodexLoginStatus('\nNot logged in\n')).toEqual({ loggedIn: false });
  });

  it('fails open on unrecognized wording', () => {
    expect(parseCodexLoginStatus('')).toBeUndefined();
    expect(parseCodexLoginStatus('Signed in via SSO')).toBeUndefined();
    // Rephrased lines must not half-match ("mentions logged in somewhere").
    expect(parseCodexLoginStatus('You are not logged in')).toBeUndefined();
  });
});

describe('CodexProbe.probeAuth', () => {
  /** A fake `codex` answering `login status`; the signed-out line rides STDERR + exit 1, like the
   * real CLI. */
  function fakeCodexCli(dir: string, statusLine: string, exit: number, stream: 1 | 2): string {
    const file = join(dir, 'codex');
    writeFileSync(
      file,
      `#!/bin/sh\nif [ "$1" = "login" ]; then echo '${statusLine}' >&${stream}; exit ${exit}; fi\necho "codex-cli 9.9.9"\n`,
    );
    chmodSync(file, 0o755);
    return file;
  }

  it('reads a signed-in status from stdout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const file = fakeCodexCli(dir, 'Logged in using ChatGPT', 0, 1);
    await expect(new CodexProbe().probeAuth(file)).resolves.toEqual({
      loggedIn: true,
      method: 'chatgpt',
    });
  });

  it('reads the signed-out status from stderr despite the non-zero exit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const file = fakeCodexCli(dir, 'Not logged in', 1, 2);
    await expect(new CodexProbe().probeAuth(file)).resolves.toEqual({ loggedIn: false });
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

    // Hermetic sdk tier: a codex whose vendored binary is unresolvable (the packaged-app shape) —
    // the real resolver would spawn this machine's CLI and leak its login state into the assert.
    class NoBinaryCodexProbe extends CodexProbe {
      override sdkPlatformBinaryPath(): string | undefined {
        return undefined;
      }
    }
    const prober = new AgentRuntimeProber([
      new ClaudeCodeProbe([join(dir, 'claude')]),
      new NoBinaryCodexProbe([join(dir, 'codex')]),
    ]);
    const runtimes = await prober.collect();
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

  it('attaches probed auth to an sdk-resolved codex runtime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const file = join(dir, 'codex');
    writeFileSync(file, "#!/bin/sh\necho 'Not logged in' >&2; exit 1\n");
    chmodSync(file, 0o755);
    class FakeBinaryCodexProbe extends CodexProbe {
      override sdkPlatformBinaryPath(): string | undefined {
        return file;
      }
    }
    const runtimes = await new AgentRuntimeProber([new FakeBinaryCodexProbe([])]).collect();
    expect(runtimes.codex).toEqual({
      status: 'available',
      source: 'sdk',
      auth: { loggedIn: false },
    });
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

  it('attaches probed auth status to a detected runtime', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-'));
    const claude = fakeAuthCli(dir, '9.9.9 (Claude Code)', '{"loggedIn":false}', 1);
    const runtimes = await new AgentRuntimeProber([new ClaudeCodeProbe([claude])]).collect();
    expect(runtimes['claude-code']).toEqual({
      status: 'available',
      source: 'detected',
      path: claude,
      version: '9.9.9',
      auth: { loggedIn: false },
    });
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
