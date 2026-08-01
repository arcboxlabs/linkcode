import type { CustomMcpServerPublic } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import type { CustomMcpServerDraft } from '../custom-mcp-patch';
import { buildCustomMcpPatch } from '../custom-mcp-patch';

const MINT = { id: 'custom-new', createdAt: 100 };

const previousStdio: CustomMcpServerPublic = {
  id: 'custom-1',
  enabled: true,
  server: {
    type: 'stdio',
    name: 'github',
    command: 'gh-mcp',
    args: ['--stdio'],
    envKeys: ['GITHUB_TOKEN', 'LOG_LEVEL'],
  },
  createdAt: 1,
};

function stdioDraft(overrides: Partial<Extract<CustomMcpServerDraft, { type: 'stdio' }>> = {}) {
  return {
    type: 'stdio',
    name: 'github',
    command: 'gh-mcp',
    args: ['--stdio'],
    secrets: [
      { key: 'GITHUB_TOKEN', value: '' },
      { key: 'LOG_LEVEL', value: '' },
    ],
    ...overrides,
  } satisfies CustomMcpServerDraft;
}

describe('buildCustomMcpPatch', () => {
  it('creates a full-plaintext add op for a new server', () => {
    const ops = buildCustomMcpPatch(
      undefined,
      stdioDraft({ secrets: [{ key: 'GITHUB_TOKEN', value: 'secret' }] }),
      MINT,
    );

    expect(ops).toEqual([
      {
        op: 'add',
        server: {
          id: 'custom-new',
          enabled: true,
          createdAt: 100,
          server: {
            type: 'stdio',
            name: 'github',
            command: 'gh-mcp',
            args: ['--stdio'],
            env: { GITHUB_TOKEN: 'secret' },
          },
        },
      },
    ]);
  });

  it('returns no ops when every secret is left blank and nothing else changed', () => {
    expect(buildCustomMcpPatch(previousStdio, stdioDraft(), MINT)).toEqual([]);
  });

  it('never resends untouched secrets: blank = keep, typed = set, flagged = remove', () => {
    const ops = buildCustomMcpPatch(
      previousStdio,
      stdioDraft({
        secrets: [
          { key: 'GITHUB_TOKEN', value: 'rotated' },
          { key: 'LOG_LEVEL', value: '', remove: true },
          { key: 'NEW_VAR', value: 'added' },
          { key: 'BLANK_NEW', value: '' },
        ],
      }),
      MINT,
    );

    expect(ops).toEqual([
      {
        op: 'update',
        id: 'custom-1',
        server: {
          type: 'stdio',
          name: 'github',
          command: 'gh-mcp',
          args: ['--stdio'],
          env: { set: { GITHUB_TOKEN: 'rotated', NEW_VAR: 'added' }, remove: ['LOG_LEVEL'] },
        },
      },
    ]);
  });

  it('emits a secret-free update when only non-secret fields changed', () => {
    const ops = buildCustomMcpPatch(previousStdio, stdioDraft({ command: 'gh-mcp-v2' }), MINT);

    expect(ops).toEqual([
      {
        op: 'update',
        id: 'custom-1',
        server: { type: 'stdio', name: 'github', command: 'gh-mcp-v2', args: ['--stdio'] },
      },
    ]);
  });

  it('ignores a remove flag for a key the server never had', () => {
    const ops = buildCustomMcpPatch(
      previousStdio,
      stdioDraft({ secrets: [{ key: 'NEVER_EXISTED', value: '', remove: true }] }),
      MINT,
    );

    expect(ops).toEqual([]);
  });

  it('expresses a transport switch as remove + add, preserving enablement', () => {
    const disabledPrevious = { ...previousStdio, enabled: false };
    const ops = buildCustomMcpPatch(
      disabledPrevious,
      {
        type: 'http',
        name: 'github',
        url: 'https://mcp.example',
        secrets: [{ key: 'Authorization', value: 'Bearer x' }],
      },
      MINT,
    );

    expect(ops).toEqual([
      { op: 'remove', id: 'custom-1' },
      {
        op: 'add',
        server: {
          id: 'custom-new',
          enabled: false,
          createdAt: 100,
          server: {
            type: 'http',
            name: 'github',
            url: 'https://mcp.example',
            headers: { Authorization: 'Bearer x' },
          },
        },
      },
    ]);
  });
});
