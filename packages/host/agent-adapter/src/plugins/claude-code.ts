import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Plugin, PluginComponent, PluginSource, StandaloneSkill } from '@linkcode/schema';
import { PluginSchema } from '@linkcode/schema';
import { z } from 'zod';
import { agentRuntimeProber, ClaudeCodeProbe } from '../probe';
import type { PluginDiscoveryOptions, PluginProviderAdapter, PluginToggleOptions } from './adapter';

const execFileAsync = promisify(execFile);
const GIT_SOURCE_RE = /^(?:https?:\/\/|git@)/;

const ClaudeMarketplaceSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  path: z.string().min(1).optional(),
  installLocation: z.string().min(1).optional(),
});

const ClaudeInstalledPluginSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1).optional(),
  scope: z.enum(['user', 'project', 'local', 'managed']).optional(),
  enabled: z.boolean(),
  installPath: z.string().min(1).optional(),
});

const ClaudeAvailablePluginSchema = z.object({
  pluginId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  marketplaceName: z.string().min(1),
  version: z.string().min(1).optional(),
  source: z.string().min(1),
});

const ClaudePluginListSchema = z.object({
  installed: z.array(ClaudeInstalledPluginSchema),
  available: z.array(ClaudeAvailablePluginSchema),
});

const ClaudePluginManifestSchema = z.object({
  name: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  description: z.string().optional(),
  author: z.union([z.string().min(1), z.object({ name: z.string().min(1) })]).optional(),
  category: z.string().min(1).optional(),
  keywords: z.array(z.string().min(1)).optional(),
});

const NamedConfigSchema = z.object({
  hooks: z.record(z.string(), z.unknown()).optional(),
  mcpServers: z.record(z.string(), z.unknown()).optional(),
  lspServers: z.record(z.string(), z.unknown()).optional(),
});

type ClaudeMarketplace = z.infer<typeof ClaudeMarketplaceSchema>;
type ClaudeInstalledPlugin = z.infer<typeof ClaudeInstalledPluginSchema>;
type ClaudeAvailablePlugin = z.infer<typeof ClaudeAvailablePluginSchema>;
type ClaudePluginManifest = z.infer<typeof ClaudePluginManifestSchema>;

export type ClaudePluginCommand = (
  args: string[],
  opts: PluginDiscoveryOptions,
) => Promise<unknown>;

/** Runner for `claude plugin` subcommands with human-text output (no `--json` exists on
 * enable/disable) — success is exit 0, stdout is discarded. */
export type ClaudePluginAction = (args: string[], opts: PluginDiscoveryOptions) => Promise<void>;

interface ClaudePluginRecord {
  id: string;
  available?: ClaudeAvailablePlugin;
  installations: ClaudeInstalledPlugin[];
}

interface ClaudePackageMetadata {
  manifest?: ClaudePluginManifest;
  components: PluginComponent[];
}

/** enable/disable verified live on CLI 2.1.220 (`claude plugin enable|disable [-s scope]`);
 * install/uninstall/update stay unimplemented by this adapter, not unsupported by the CLI. */
const CLAUDE_MANAGEMENT_CAPABILITIES = {
  install: false,
  uninstall: false,
  update: false,
  enable: true,
  disable: true,
} as const;

/** `-s` values the CLI accepts (2.1.220); `managed` installs have no toggle flag. */
const CLAUDE_TOGGLE_SCOPES = new Set<string>(['user', 'project', 'local']);

/**
 * Claude's verified machine-readable plugin surface (CLI 2.1.212): `plugin list --available
 * --json` returns installed/available records and `plugin marketplace list --json` supplies their
 * local marketplace roots. Package component files remain provider-owned and are read-only here.
 */
export class ClaudeCodePluginAdapter implements PluginProviderAdapter {
  readonly provider = 'claude-code' as const;

  constructor(
    private readonly command: ClaudePluginCommand = runClaudePluginCommand,
    private readonly userSkillsDir: string = join(homedir(), '.claude', 'skills'),
    private readonly action: ClaudePluginAction = runClaudePluginAction,
  ) {}

  /**
   * Trap verified live on 2.1.220: enable/disable exit 0 even for a plugin that does not exist
   * (the CLI blind-writes `enabledPlugins`), so exit code alone never proves the toggle landed on
   * a real install — the engine re-lists after this call and that readback is the success check.
   */
  async setPluginEnabled(
    id: string,
    enabled: boolean,
    opts: PluginToggleOptions = {},
  ): Promise<void> {
    const args = ['plugin', enabled ? 'enable' : 'disable', id];
    if (opts.scope && CLAUDE_TOGGLE_SCOPES.has(opts.scope)) args.push('-s', opts.scope);
    await this.action(args, { cwd: opts.cwd });
  }

  async list(opts: PluginDiscoveryOptions = {}): Promise<Plugin[]> {
    const [pluginsValue, marketplacesValue] = await Promise.all([
      this.command(['plugin', 'list', '--available', '--json'], opts),
      this.command(['plugin', 'marketplace', 'list', '--json'], opts),
    ]);
    const catalog = ClaudePluginListSchema.parse(pluginsValue);
    const marketplaces = z.array(ClaudeMarketplaceSchema).parse(marketplacesValue);
    return normalizeClaudePlugins(catalog, marketplaces);
  }

  /** Personal/project Agent Skills are bare `SKILL.md` directories that `claude plugin list`
   * never surfaces (verified on CLI 2.1.220) — a plain filesystem read is the only source.
   * No CLI toggle exists for them, so `toggleable` is always false. */
  async listStandaloneSkills(opts: PluginDiscoveryOptions = {}): Promise<StandaloneSkill[]> {
    const roots: { dir: string; scope: StandaloneSkill['scope'] }[] = [
      { dir: this.userSkillsDir, scope: 'user' },
    ];
    if (opts.cwd) roots.push({ dir: join(opts.cwd, '.claude', 'skills'), scope: 'project' });
    const groups = await Promise.all(
      roots.map(({ dir, scope }) => readClaudeSkillsDirectory(dir, scope)),
    );
    return groups.flat();
  }
}

async function readClaudeSkillsDirectory(
  dir: string,
  scope: StandaloneSkill['scope'],
): Promise<StandaloneSkill[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const reads: Array<Promise<StandaloneSkill | undefined>> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    reads.push(readClaudeSkill(dir, entry.name, scope));
  }
  const skills = await Promise.all(reads);
  return skills
    .filter((skill) => skill !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function readClaudeSkill(
  dir: string,
  id: string,
  scope: StandaloneSkill['scope'],
): Promise<StandaloneSkill | undefined> {
  const path = join(dir, id);
  let frontmatter;
  try {
    frontmatter = parseSkillFrontmatter(await readFile(join(path, 'SKILL.md'), 'utf8'));
  } catch {
    return undefined;
  }
  return {
    provider: 'claude-code',
    id,
    name: frontmatter.name ?? id,
    description: frontmatter.description,
    scope,
    path,
    toggleable: false,
  };
}

const RE_SKILL_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const RE_LINE_BREAK = /\r?\n/;

/** SKILL.md frontmatter is a flat two-key block (name/description, optionally quoted) — a full
 * YAML parser is unwarranted and would be a new dependency. */
function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = RE_SKILL_FRONTMATTER.exec(content);
  if (!match) return {};
  const fields: { name?: string; description?: string } = {};
  for (const line of match[1].split(RE_LINE_BREAK)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (key !== 'name' && key !== 'description') continue;
    const raw = line.slice(separator + 1).trim();
    const unquoted =
      (raw[0] === '"' && raw.endsWith('"')) || (raw[0] === "'" && raw.endsWith("'"))
        ? raw.slice(1, -1)
        : raw;
    if (unquoted) fields[key] = unquoted;
  }
  return fields;
}

async function runClaudePluginCommand(
  args: string[],
  opts: PluginDiscoveryOptions,
): Promise<unknown> {
  const { stdout } = await execClaudeCli(args, opts);
  return JSON.parse(stdout) as unknown;
}

async function runClaudePluginAction(args: string[], opts: PluginDiscoveryOptions): Promise<void> {
  await execClaudeCli(args, opts);
}

function execClaudeCli(args: string[], opts: PluginDiscoveryOptions) {
  const binaryPath =
    agentRuntimeProber.resolveBinary('claude-code') ??
    new ClaudeCodeProbe().sdkPlatformBinaryPath();
  if (!binaryPath) throw new Error('claude-code: CLI is not available');
  return execFileAsync(binaryPath, args, {
    cwd: opts.cwd,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30000,
    windowsHide: true,
  });
}

async function normalizeClaudePlugins(
  catalog: z.infer<typeof ClaudePluginListSchema>,
  marketplaces: ClaudeMarketplace[],
): Promise<Plugin[]> {
  const marketplaceByName = new Map(
    marketplaces.map((marketplace) => [marketplace.name, marketplace]),
  );
  const records = new Map<string, ClaudePluginRecord>();
  for (const available of catalog.available) {
    records.set(available.pluginId, {
      id: available.pluginId,
      available,
      installations: [],
    });
  }
  for (const installed of catalog.installed) {
    const record = records.get(installed.id) ?? { id: installed.id, installations: [] };
    record.installations.push(installed);
    records.set(installed.id, record);
  }

  return Promise.all(
    [...records.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((record) => normalizeClaudePlugin(record, marketplaceByName)),
  );
}

async function normalizeClaudePlugin(
  record: ClaudePluginRecord,
  marketplaceByName: ReadonlyMap<string, ClaudeMarketplace>,
): Promise<Plugin> {
  const identity = claudePluginIdentity(record.id);
  const marketplaceName = record.available?.marketplaceName ?? identity.marketplaceName;
  const marketplace = marketplaceName ? marketplaceByName.get(marketplaceName) : undefined;
  const availablePackagePath = record.available
    ? claudePackagePath(record.available.source, marketplace)
    : undefined;
  const packagePath =
    record.installations.find((item) => item.installPath)?.installPath ?? availablePackagePath;
  const metadata = packagePath ? await readClaudePackage(packagePath) : { components: [] };
  const manifest = metadata.manifest;
  const authorName =
    typeof manifest?.author === 'string' ? manifest.author : manifest?.author?.name;

  return PluginSchema.parse({
    provider: 'claude-code',
    id: record.id,
    name: record.available?.name ?? manifest?.name ?? identity.name,
    version: record.available?.version ?? manifest?.version,
    description: record.available?.description ?? manifest?.description,
    author: authorName ? { name: authorName } : undefined,
    category: manifest?.category,
    keywords: manifest?.keywords ?? [],
    marketplace: marketplaceName
      ? {
          name: marketplaceName,
          path: marketplace?.installLocation ?? marketplace?.path,
        }
      : undefined,
    source: claudePluginSource(record, marketplace, packagePath),
    availability: 'available',
    installations: record.installations.map((installed) => ({
      enabled: installed.enabled,
      version: installed.version,
      scope: installed.scope,
      path: installed.installPath,
    })),
    components: metadata.components,
    assets: [],
    managementCapabilities: CLAUDE_MANAGEMENT_CAPABILITIES,
  });
}

function claudePluginIdentity(id: string): { name: string; marketplaceName?: string } {
  const separator = id.lastIndexOf('@');
  if (separator <= 0 || separator === id.length - 1) return { name: id };
  return { name: id.slice(0, separator), marketplaceName: id.slice(separator + 1) };
}

function claudePackagePath(
  source: string,
  marketplace: ClaudeMarketplace | undefined,
): string | undefined {
  if (isAbsolute(source)) return source;
  const marketplacePath = marketplace?.installLocation ?? marketplace?.path;
  if (marketplacePath && (source.startsWith('./') || source.startsWith('../'))) {
    return resolve(marketplacePath, source);
  }
  return undefined;
}

function claudePluginSource(
  record: ClaudePluginRecord,
  marketplace: ClaudeMarketplace | undefined,
  packagePath: string | undefined,
): PluginSource | undefined {
  const source = record.available?.source;
  const availablePath = source ? claudePackagePath(source, marketplace) : undefined;
  if (availablePath) return { type: 'local', path: availablePath };
  if (source && GIT_SOURCE_RE.test(source)) return { type: 'git', url: source };
  if (packagePath) return { type: 'local', path: packagePath };
  return source ? { type: 'remote' } : undefined;
}

async function readClaudePackage(packagePath: string): Promise<ClaudePackageMetadata> {
  const [manifest, ...componentGroups] = await Promise.all([
    readClaudeManifest(packagePath),
    readDirectoryComponents(packagePath, 'skills', 'skill'),
    readDirectoryComponents(packagePath, 'commands', 'command'),
    readDirectoryComponents(packagePath, 'agents', 'agent'),
    readDirectoryComponents(packagePath, 'output-styles', 'output-style'),
    readNamedConfig(join(packagePath, 'hooks', 'hooks.json'), 'hooks', 'hook'),
    readNamedConfig(join(packagePath, '.mcp.json'), 'mcpServers', 'mcp-server'),
    readNamedConfig(join(packagePath, '.lsp.json'), 'lspServers', 'lsp-server'),
  ]);
  const components = componentGroups.flat().sort((left, right) => {
    const kind = left.kind.localeCompare(right.kind);
    return kind === 0 ? left.name.localeCompare(right.name) : kind;
  });
  return { manifest, components };
}

async function readClaudeManifest(packagePath: string): Promise<ClaudePluginManifest | undefined> {
  try {
    const value: unknown = JSON.parse(
      await readFile(join(packagePath, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    const parsed = ClaudePluginManifestSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function readDirectoryComponents(
  packagePath: string,
  directory: string,
  kind: Extract<PluginComponent['kind'], 'skill' | 'command' | 'agent' | 'output-style'>,
): Promise<PluginComponent[]> {
  try {
    const entries = await readdir(join(packagePath, directory), { withFileTypes: true });
    return entries.flatMap((entry) => {
      if (entry.isDirectory()) return [{ kind, name: entry.name }];
      if (entry.isFile() && entry.name.endsWith('.md')) {
        return [{ kind, name: entry.name.slice(0, -3) }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

async function readNamedConfig(
  file: string,
  field: 'hooks' | 'mcpServers' | 'lspServers',
  kind: Extract<PluginComponent['kind'], 'hook' | 'mcp-server' | 'lsp-server'>,
): Promise<PluginComponent[]> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    const parsed = NamedConfigSchema.safeParse(value);
    if (!parsed.success) return [];
    return Object.keys(parsed.data[field] ?? {}).map((name) => ({ kind, name }));
  } catch {
    return [];
  }
}
