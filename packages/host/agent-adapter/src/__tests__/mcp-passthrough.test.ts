import type { McpServer } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { claudeMcpServers } from '../native/claude-code';
import { codexMcpConfigOverrides } from '../native/codex/adapter';
import { opencodeMcpConfig } from '../native/opencode/adapter';

const HTTP: McpServer = { type: 'http', name: 'linkcode-sim', url: 'http://127.0.0.1:7777/mcp/t' };
const STDIO: McpServer = {
  type: 'stdio',
  name: 'files',
  command: '/usr/local/bin/files-mcp',
  args: ['--root', '/tmp'],
  env: { DEBUG: '1' },
};

describe('claudeMcpServers', () => {
  it('maps http and stdio entries onto the SDK record shape', () => {
    expect(claudeMcpServers([HTTP, STDIO])).toEqual({
      'linkcode-sim': { type: 'http', url: HTTP.url },
      files: {
        type: 'stdio',
        command: '/usr/local/bin/files-mcp',
        args: ['--root', '/tmp'],
        env: { DEBUG: '1' },
      },
    });
  });

  it('returns undefined for empty input so query options omit the key', () => {
    expect(claudeMcpServers(undefined)).toBeUndefined();
    expect(claudeMcpServers([])).toBeUndefined();
  });
});

describe('codexMcpConfigOverrides', () => {
  it('maps entries onto dotted config keys and arms the rmcp client for http', () => {
    expect(codexMcpConfigOverrides([HTTP, STDIO])).toEqual({
      'mcp_servers.linkcode-sim.url': HTTP.url,
      'mcp_servers.files.command': '/usr/local/bin/files-mcp',
      'mcp_servers.files.args': ['--root', '/tmp'],
      'mcp_servers.files.env': { DEBUG: '1' },
      experimental_use_rmcp_client: true,
    });
  });

  it('rejects http servers with headers instead of silently dropping auth', () => {
    expect(() =>
      codexMcpConfigOverrides([{ ...HTTP, headers: { authorization: 'Bearer x' } }]),
    ).toThrow('HTTP headers are not supported');
  });

  it('returns an empty record for no servers', () => {
    expect(codexMcpConfigOverrides(undefined)).toEqual({});
  });
});

describe('opencodeMcpConfig', () => {
  it('maps http to remote and stdio to local command arrays', () => {
    expect(opencodeMcpConfig([HTTP, STDIO])).toEqual({
      'linkcode-sim': { type: 'remote', url: HTTP.url, enabled: true },
      files: {
        type: 'local',
        command: ['/usr/local/bin/files-mcp', '--root', '/tmp'],
        enabled: true,
        environment: { DEBUG: '1' },
      },
    });
  });

  it('returns undefined for empty input so server options omit the key', () => {
    expect(opencodeMcpConfig(undefined)).toBeUndefined();
  });
});
