import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClaudePluginCommand } from '../plugins/claude-code';
import { ClaudeCodePluginAdapter } from '../plugins/claude-code';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ClaudeCodePluginAdapter', () => {
  it('normalizes native marketplaces, install scopes, manifests, and component files', async () => {
    const marketplaceRoot = await mkdtemp(join(tmpdir(), 'linkcode-claude-marketplace-'));
    tempRoots.push(marketplaceRoot);
    const packageRoot = join(marketplaceRoot, 'plugins', 'latex');
    await Promise.all([
      mkdir(join(packageRoot, '.claude-plugin'), { recursive: true }),
      mkdir(join(packageRoot, 'skills', 'latex'), { recursive: true }),
      mkdir(join(packageRoot, 'commands'), { recursive: true }),
      mkdir(join(packageRoot, 'agents'), { recursive: true }),
      mkdir(join(packageRoot, 'hooks'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(packageRoot, '.claude-plugin', 'plugin.json'),
        JSON.stringify({
          name: 'latex',
          version: '1.2.3',
          description: 'Compile LaTeX documents',
          author: { name: 'LinkCode' },
          category: 'documents',
          keywords: ['latex', 'pdf'],
        }),
      ),
      writeFile(join(packageRoot, 'commands', 'render.md'), '# Render'),
      writeFile(join(packageRoot, 'agents', 'reviewer.md'), '# Review'),
      writeFile(
        join(packageRoot, 'hooks', 'hooks.json'),
        JSON.stringify({ hooks: { PostToolUse: [] } }),
      ),
      writeFile(join(packageRoot, '.mcp.json'), JSON.stringify({ mcpServers: { documents: {} } })),
    ]);
    const command: ClaudePluginCommand = vi.fn((args) => {
      if (args[1] === 'marketplace') {
        return Promise.resolve([
          {
            name: 'team-tools',
            source: 'directory',
            path: marketplaceRoot,
            installLocation: marketplaceRoot,
          },
        ]);
      }
      return Promise.resolve({
        installed: [
          {
            id: 'latex@team-tools',
            version: '1.2.3',
            scope: 'user',
            enabled: true,
            installPath: packageRoot,
          },
          {
            id: 'latex@team-tools',
            version: '1.2.3',
            scope: 'project',
            enabled: false,
            installPath: packageRoot,
          },
        ],
        available: [],
      });
    });

    const plugins = await new ClaudeCodePluginAdapter(command).list({ cwd: '/workspace/demo' });

    expect(plugins).toEqual([
      expect.objectContaining({
        provider: 'claude-code',
        id: 'latex@team-tools',
        name: 'latex',
        version: '1.2.3',
        description: 'Compile LaTeX documents',
        author: { name: 'LinkCode' },
        category: 'documents',
        keywords: ['latex', 'pdf'],
        marketplace: {
          name: 'team-tools',
          path: marketplaceRoot,
        },
        source: { type: 'local', path: packageRoot },
        installations: [
          {
            enabled: true,
            version: '1.2.3',
            scope: 'user',
            path: packageRoot,
          },
          {
            enabled: false,
            version: '1.2.3',
            scope: 'project',
            path: packageRoot,
          },
        ],
        components: [
          { kind: 'agent', name: 'reviewer' },
          { kind: 'command', name: 'render' },
          { kind: 'hook', name: 'PostToolUse' },
          { kind: 'mcp-server', name: 'documents' },
          { kind: 'skill', name: 'latex' },
        ],
        assets: [],
        managementCapabilities: {
          install: false,
          uninstall: false,
          update: false,
          enable: false,
          disable: false,
        },
      }),
    ]);
    expect(command).toHaveBeenCalledWith(['plugin', 'list', '--available', '--json'], {
      cwd: '/workspace/demo',
    });
  });

  it('rejects malformed provider output at the boundary', async () => {
    const command: ClaudePluginCommand = (args) =>
      Promise.resolve(args[1] === 'marketplace' ? [] : { installed: 'invalid', available: [] });

    await expect(new ClaudeCodePluginAdapter(command).list()).rejects.toThrow();
  });
});
