import { describe, expect, it } from 'vitest';
import {
  CustomMcpServerPatchOpSchema,
  CustomMcpServerPublicSchema,
  CustomMcpServerSchema,
} from '../custom-mcp';

describe('CustomMcpServerSchema', () => {
  it('accepts a stdio server with inline secrets', () => {
    const parsed = CustomMcpServerSchema.safeParse({
      id: 'custom-1',
      enabled: true,
      server: {
        type: 'stdio',
        name: 'github',
        command: 'gh-mcp',
        env: { GITHUB_TOKEN: 'secret' },
      },
      createdAt: 1,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('CustomMcpServerPublicSchema', () => {
  it('carries only key lists where the full model carries values', () => {
    const parsed = CustomMcpServerPublicSchema.safeParse({
      id: 'custom-1',
      enabled: true,
      server: { type: 'stdio', name: 'github', command: 'gh-mcp', envKeys: ['GITHUB_TOKEN'] },
      createdAt: 1,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a projection that still contains secret values', () => {
    const parsed = CustomMcpServerPublicSchema.safeParse({
      id: 'custom-1',
      enabled: true,
      server: {
        type: 'stdio',
        name: 'github',
        command: 'gh-mcp',
        env: { GITHUB_TOKEN: 'secret' },
      },
      createdAt: 1,
    });
    expect(parsed.success).toBe(false);
  });
});

describe('CustomMcpServerPatchOpSchema', () => {
  it('accepts an add op with a full plaintext server', () => {
    const parsed = CustomMcpServerPatchOpSchema.safeParse({
      op: 'add',
      server: {
        id: 'custom-1',
        enabled: true,
        server: { type: 'http', name: 'search', url: 'https://mcp.example', headers: { A: 'b' } },
        createdAt: 1,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts an enabled-only update that never mentions secrets', () => {
    const parsed = CustomMcpServerPatchOpSchema.safeParse({
      op: 'update',
      id: 'custom-1',
      enabled: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('expresses secret edits per key, not as whole-value replacement', () => {
    const parsed = CustomMcpServerPatchOpSchema.safeParse({
      op: 'update',
      id: 'custom-1',
      server: {
        type: 'stdio',
        name: 'github',
        command: 'gh-mcp',
        env: { set: { GITHUB_TOKEN: 'rotated' }, remove: ['STALE_VAR'] },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an update whose env is a plain value map', () => {
    const parsed = CustomMcpServerPatchOpSchema.safeParse({
      op: 'update',
      id: 'custom-1',
      server: {
        type: 'stdio',
        name: 'github',
        command: 'gh-mcp',
        env: { GITHUB_TOKEN: 'value' },
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown ops', () => {
    const parsed = CustomMcpServerPatchOpSchema.safeParse({ op: 'replace-all', servers: [] });
    expect(parsed.success).toBe(false);
  });
});
