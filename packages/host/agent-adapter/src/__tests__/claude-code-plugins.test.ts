import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asyncNoop } from 'foxts/noop';
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
          enable: true,
          disable: true,
        },
      }),
    ]);
    expect(command).toHaveBeenCalledWith(['plugin', 'list', '--available', '--json'], {
      cwd: '/workspace/demo',
    });
  });

  it('accepts every observed available-plugin source shape and a null version', async () => {
    // Shapes verified live against CLI 2.1.220 across 275 marketplace entries (CODE-505); a
    // stricter schema fails the whole array, which empties the page instead of one entry.
    const command: ClaudePluginCommand = (args) =>
      Promise.resolve(
        args[1] === 'marketplace'
          ? [{ name: 'm', source: 'github', repo: 'owner/repo', installLocation: '/mk' }]
          : {
              installed: [],
              available: [
                {
                  pluginId: 'sub@m',
                  name: 'sub',
                  marketplaceName: 'm',
                  version: null,
                  source: {
                    source: 'git-subdir',
                    url: 'https://github.com/owner/repo.git',
                    path: 'plugins/sub',
                    ref: 'v1.5.5',
                    sha: 'deadbeef',
                  },
                },
                {
                  pluginId: 'url@m',
                  name: 'url',
                  marketplaceName: 'm',
                  source: { source: 'url', url: 'https://github.com/o/r.git', sha: 'cafe' },
                },
                {
                  pluginId: 'gh@m',
                  name: 'gh',
                  marketplaceName: 'm',
                  source: { source: 'github', repo: 'owner/skills', sha: 'f00d' },
                },
                { pluginId: 'rel@m', name: 'rel', marketplaceName: 'm', source: './plugins/rel' },
              ],
            },
      );

    const plugins = await new ClaudeCodePluginAdapter(command).list();

    expect(plugins.map((plugin) => [plugin.id, plugin.source, plugin.version])).toEqual([
      [
        'gh@m',
        { type: 'git', url: 'https://github.com/owner/skills.git', commit: 'f00d' },
        undefined,
      ],
      ['rel@m', { type: 'local', path: '/mk/plugins/rel' }, undefined],
      [
        'sub@m',
        {
          type: 'git',
          url: 'https://github.com/owner/repo.git',
          path: 'plugins/sub',
          ref: 'v1.5.5',
          commit: 'deadbeef',
        },
        undefined,
      ],
      ['url@m', { type: 'git', url: 'https://github.com/o/r.git', commit: 'cafe' }, undefined],
    ]);
  });

  it('rejects malformed provider output at the boundary', async () => {
    const command: ClaudePluginCommand = (args) =>
      Promise.resolve(args[1] === 'marketplace' ? [] : { installed: 'invalid', available: [] });

    await expect(new ClaudeCodePluginAdapter(command).list()).rejects.toThrow();
  });

  it('discovers standalone skills from the user and project skill directories', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'linkcode-claude-skills-user-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'linkcode-claude-skills-project-'));
    tempRoots.push(userRoot, projectRoot);
    const projectSkills = join(projectRoot, '.claude', 'skills');
    await Promise.all([
      mkdir(join(userRoot, 'docx'), { recursive: true }),
      mkdir(join(userRoot, 'no-manifest'), { recursive: true }),
      mkdir(join(projectSkills, 'deploy'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(userRoot, 'docx', 'SKILL.md'),
        '---\nname: "Word documents"\ndescription: \'Create .docx files\'\nlicense: MIT\n---\nBody',
      ),
      writeFile(join(userRoot, 'stray-file.md'), 'not a skill directory'),
      writeFile(join(projectSkills, 'deploy', 'SKILL.md'), '---\ndescription: Ship it\n---'),
    ]);
    const command: ClaudePluginCommand = () => Promise.reject(new Error('not used'));

    const skills = await new ClaudeCodePluginAdapter(command, userRoot).listStandaloneSkills({
      cwd: projectRoot,
    });

    expect(skills).toEqual([
      {
        provider: 'claude-code',
        id: 'docx',
        name: 'Word documents',
        description: 'Create .docx files',
        scope: 'user',
        path: join(userRoot, 'docx'),
        enabled: true,
        toggleable: true,
      },
      {
        provider: 'claude-code',
        id: 'deploy',
        name: 'deploy',
        description: 'Ship it',
        scope: 'project',
        path: join(projectSkills, 'deploy'),
        enabled: true,
        toggleable: true,
      },
    ]);
  });

  it('returns no standalone skills when the skill roots do not exist', async () => {
    const command: ClaudePluginCommand = () => Promise.reject(new Error('not used'));
    const adapter = new ClaudeCodePluginAdapter(command, '/nonexistent/claude/skills');

    await expect(adapter.listStandaloneSkills()).resolves.toEqual([]);
  });

  it('toggles a plugin with an explicit CLI scope and refuses managed scope', async () => {
    const command: ClaudePluginCommand = () => Promise.reject(new Error('not used'));
    const action = vi.fn(asyncNoop);
    const adapter = new ClaudeCodePluginAdapter(command, '/nonexistent', action);

    await adapter.setPluginEnabled('latex@team-tools', true, {
      scope: 'project',
      cwd: '/workspace/demo',
    });
    await expect(
      adapter.setPluginEnabled('latex@team-tools', false, { scope: 'managed' }),
    ).rejects.toThrow('managed plugins cannot be toggled');
    await adapter.setPluginEnabled('latex@team-tools', false);

    expect(action.mock.calls).toEqual([
      [['plugin', 'enable', 'latex@team-tools', '-s', 'project'], { cwd: '/workspace/demo' }],
      [['plugin', 'disable', 'latex@team-tools'], { cwd: undefined }],
    ]);
  });

  it('reflects skillOverrides in discovery and writes only the off tier back', async () => {
    const home = await mkdtemp(join(tmpdir(), 'linkcode-claude-skill-overrides-'));
    tempRoots.push(home);
    const skillsDir = join(home, 'skills');
    const settingsFile = join(home, 'settings.json');
    await Promise.all([
      mkdir(join(skillsDir, 'docx'), { recursive: true }),
      mkdir(join(skillsDir, 'pptx'), { recursive: true }),
      mkdir(join(skillsDir, 'xlsx'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(skillsDir, 'docx', 'SKILL.md'), '---\nname: docx\n---'),
      writeFile(join(skillsDir, 'pptx', 'SKILL.md'), '---\nname: pptx\n---'),
      writeFile(join(skillsDir, 'xlsx', 'SKILL.md'), '---\nname: xlsx\n---'),
      writeFile(
        settingsFile,
        JSON.stringify({
          permissions: { defaultMode: 'acceptEdits' },
          skillOverrides: { docx: 'off', pptx: 'name-only' },
        }),
      ),
    ]);
    const command: ClaudePluginCommand = () => Promise.reject(new Error('not used'));
    const adapter = new ClaudeCodePluginAdapter(command, skillsDir, asyncNoop, settingsFile);

    const discovered = await adapter.listStandaloneSkills();
    expect(discovered.map((skill) => [skill.id, skill.enabled, skill.toggleable])).toEqual([
      ['docx', false, true],
      // A finer-grained tier is not "off": the skill still lists, so it reads as enabled.
      ['pptx', true, true],
      ['xlsx', true, true],
    ]);

    // Disabling writes the off tier; unrelated settings and other overrides survive.
    await adapter.setSkillEnabled({ id: 'xlsx', path: '', scope: 'user' }, false);
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      permissions: { defaultMode: 'acceptEdits' },
      skillOverrides: { docx: 'off', pptx: 'name-only', xlsx: 'off' },
    });

    // Re-enabling drops the key (absent = on) but never coarsens someone else's finer tier.
    await adapter.setSkillEnabled({ id: 'docx', path: '', scope: 'user' }, true);
    await adapter.setSkillEnabled({ id: 'pptx', path: '', scope: 'user' }, true);
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      permissions: { defaultMode: 'acceptEdits' },
      skillOverrides: { pptx: 'name-only', xlsx: 'off' },
    });
  });

  it('creates a settings file and drops an empty override map', async () => {
    const home = await mkdtemp(join(tmpdir(), 'linkcode-claude-skill-fresh-'));
    tempRoots.push(home);
    const settingsFile = join(home, 'nested', 'settings.json');
    const command: ClaudePluginCommand = () => Promise.reject(new Error('not used'));
    const adapter = new ClaudeCodePluginAdapter(
      command,
      join(home, 'skills'),
      asyncNoop,
      settingsFile,
    );

    await adapter.setSkillEnabled({ id: 'docx', path: '', scope: 'user' }, false);
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      skillOverrides: { docx: 'off' },
    });

    await adapter.setSkillEnabled({ id: 'docx', path: '', scope: 'user' }, true);
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({});
    expect((await stat(settingsFile)).mode & 0o777).toBe(0o600);
  });

  it('writes project overrides locally without changing shared settings', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'linkcode-claude-project-skill-'));
    tempRoots.push(cwd);
    const sharedFile = join(cwd, '.claude', 'settings.json');
    const localFile = join(cwd, '.claude', 'settings.local.json');
    const shared = '{"permissions":{"defaultMode":"plan"}}\n';
    await mkdir(join(cwd, '.claude'), { recursive: true });
    await writeFile(sharedFile, shared);
    const adapter = new ClaudeCodePluginAdapter(
      () => Promise.reject(new Error('not used')),
      join(cwd, 'user-skills'),
    );

    await adapter.setSkillEnabled({ id: 'deploy', path: '', scope: 'project' }, false, { cwd });

    expect(await readFile(sharedFile, 'utf8')).toBe(shared);
    expect(JSON.parse(await readFile(localFile, 'utf8'))).toEqual({
      skillOverrides: { deploy: 'off' },
    });
    expect((await stat(localFile)).mode & 0o777).toBe(0o600);
  });

  it('writes an explicit local on tier over a shared project off tier', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'linkcode-claude-project-skill-on-'));
    tempRoots.push(cwd);
    const skillDir = join(cwd, '.claude', 'skills', 'deploy');
    await mkdir(skillDir, { recursive: true });
    await Promise.all([
      writeFile(join(skillDir, 'SKILL.md'), '---\nname: deploy\n---'),
      writeFile(
        join(cwd, '.claude', 'settings.json'),
        JSON.stringify({ skillOverrides: { deploy: 'off' } }),
      ),
    ]);
    const adapter = new ClaudeCodePluginAdapter(
      () => Promise.reject(new Error('not used')),
      join(cwd, 'user-skills'),
    );

    await adapter.setSkillEnabled({ id: 'deploy', path: skillDir, scope: 'project' }, true, {
      cwd,
    });

    expect(JSON.parse(await readFile(join(cwd, '.claude', 'settings.local.json'), 'utf8'))).toEqual(
      { skillOverrides: { deploy: 'on' } },
    );
    await expect(adapter.listStandaloneSkills({ cwd })).resolves.toEqual([
      expect.objectContaining({ id: 'deploy', enabled: true }),
    ]);
  });

  it('preserves destination permissions across an atomic settings write', async () => {
    const home = await mkdtemp(join(tmpdir(), 'linkcode-claude-skill-mode-'));
    tempRoots.push(home);
    const settingsFile = join(home, 'settings.json');
    await writeFile(settingsFile, '{}');
    await chmod(settingsFile, 0o640);
    const adapter = new ClaudeCodePluginAdapter(
      () => Promise.reject(new Error('not used')),
      join(home, 'skills'),
      asyncNoop,
      settingsFile,
    );

    await adapter.setSkillEnabled({ id: 'docx', path: '', scope: 'user' }, false);

    expect((await stat(settingsFile)).mode & 0o777).toBe(0o640);
  });

  it.each([
    ['malformed JSON', '{broken'],
    ['non-object JSON', '[]'],
  ])('rejects %s without replacing the settings file', async (_label, original) => {
    const home = await mkdtemp(join(tmpdir(), 'linkcode-claude-skill-invalid-'));
    tempRoots.push(home);
    const settingsFile = join(home, 'settings.json');
    await writeFile(settingsFile, original);
    const adapter = new ClaudeCodePluginAdapter(
      () => Promise.reject(new Error('not used')),
      join(home, 'skills'),
      asyncNoop,
      settingsFile,
    );

    await expect(
      adapter.setSkillEnabled({ id: 'docx', path: '', scope: 'user' }, false),
    ).rejects.toThrow();
    expect(await readFile(settingsFile, 'utf8')).toBe(original);
  });

  it('serializes concurrent skill toggles across adapter instances', async () => {
    const home = await mkdtemp(join(tmpdir(), 'linkcode-claude-skill-concurrent-'));
    tempRoots.push(home);
    const settingsFile = join(home, 'settings.json');
    const command: ClaudePluginCommand = () => Promise.reject(new Error('not used'));
    const first = new ClaudeCodePluginAdapter(
      command,
      join(home, 'skills'),
      asyncNoop,
      settingsFile,
    );
    const second = new ClaudeCodePluginAdapter(
      command,
      join(home, 'skills'),
      asyncNoop,
      settingsFile,
    );

    await Promise.all([
      first.setSkillEnabled({ id: 'docx', path: '', scope: 'user' }, false),
      second.setSkillEnabled({ id: 'pptx', path: '', scope: 'user' }, false),
    ]);

    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      skillOverrides: { docx: 'off', pptx: 'off' },
    });
  });

  it('targets the project-local settings file for a project-scoped skill', async () => {
    const home = await mkdtemp(join(tmpdir(), 'linkcode-claude-skill-project-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'linkcode-claude-skill-repo-'));
    tempRoots.push(home, projectRoot);
    const userSettings = join(home, 'settings.json');
    const command: ClaudePluginCommand = () => Promise.reject(new Error('not used'));
    const adapter = new ClaudeCodePluginAdapter(
      command,
      join(home, 'skills'),
      asyncNoop,
      userSettings,
    );

    await adapter.setSkillEnabled({ id: 'deploy', path: '', scope: 'project' }, false, {
      cwd: projectRoot,
    });

    expect(
      JSON.parse(await readFile(join(projectRoot, '.claude', 'settings.local.json'), 'utf8')),
    ).toEqual({ skillOverrides: { deploy: 'off' } });
    await expect(readFile(userSettings, 'utf8')).rejects.toThrow();
  });

  it('propagates a toggle failure from the CLI', async () => {
    const command: ClaudePluginCommand = () => Promise.reject(new Error('not used'));
    const action = vi.fn(() => Promise.reject(new Error('exit 1')));
    const adapter = new ClaudeCodePluginAdapter(command, '/nonexistent', action);

    await expect(adapter.setPluginEnabled('latex@team-tools', true)).rejects.toThrow('exit 1');
  });
});
