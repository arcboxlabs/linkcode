import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { vendoredAgentBinary } from '../native/agent-bin';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('vendoredAgentBinary', () => {
  it('returns undefined when the host provides no directory', () => {
    vi.stubEnv('LINKCODE_AGENT_BIN_DIR', '');
    expect(vendoredAgentBinary('claude-code', 'claude')).toBeUndefined();
  });

  it('resolves <dir>/<kind>/<binary> when it exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-bin-'));
    mkdirSync(join(dir, 'claude-code'), { recursive: true });
    writeFileSync(join(dir, 'claude-code', 'claude'), '');
    vi.stubEnv('LINKCODE_AGENT_BIN_DIR', dir);
    expect(vendoredAgentBinary('claude-code', 'claude')).toBe(join(dir, 'claude-code', 'claude'));
  });

  it('returns undefined when the binary is absent from the directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-bin-'));
    vi.stubEnv('LINKCODE_AGENT_BIN_DIR', dir);
    expect(vendoredAgentBinary('claude-code', 'claude')).toBeUndefined();
  });
});
