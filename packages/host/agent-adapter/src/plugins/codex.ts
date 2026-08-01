import type {
  Plugin,
  PluginComponent,
  PluginLinks,
  PluginSource,
  StandaloneSkill,
} from '@linkcode/schema';
import { PluginSchema } from '@linkcode/schema';
import { never } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { z } from 'zod';
import { CodexAppServer, resolveCodexBinaryPath } from '../native/codex/app-server';
import { agentRuntimeProber } from '../probe';
import type {
  PluginDiscoveryOptions,
  PluginInstallOutcome,
  PluginProviderAdapter,
  PluginToggleOptions,
  SkillToggleTarget,
} from './adapter';

// `.nullish()`, not `.nullable()`: codex 0.144.1 omits keys entirely (e.g. a marketplace
// plugin with no `version`), and a required-but-null shape fails the whole catalog parse.
const OptionalStringSchema = z.string().min(1).nullish();
const OptionalUrlSchema = z.url().nullish().catch(null);
const OptionalHttpUrlSchema = z.httpUrl().nullish().catch(null);
const DISCOVERY_TIMEOUT_MS = 30000;

const CodexPluginSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('local'), path: z.string().min(1) }),
  z.object({
    type: z.literal('git'),
    url: z.string().min(1),
    path: OptionalStringSchema,
    refName: OptionalStringSchema,
    sha: OptionalStringSchema,
  }),
  z.object({
    type: z.literal('npm'),
    package: z.string().min(1),
    version: OptionalStringSchema,
    registry: OptionalHttpUrlSchema,
  }),
  z.object({ type: z.literal('remote') }),
]);

const CodexPluginInterfaceSchema = z.object({
  displayName: OptionalStringSchema,
  shortDescription: z.string().nullish(),
  longDescription: z.string().nullish(),
  developerName: OptionalStringSchema,
  category: OptionalStringSchema,
  capabilities: z.array(z.string()).default([]),
  websiteUrl: OptionalUrlSchema,
  privacyPolicyUrl: OptionalUrlSchema,
  termsOfServiceUrl: OptionalUrlSchema,
});

const CodexPluginSummarySchema = z.object({
  id: z.string().min(1),
  remotePluginId: OptionalStringSchema,
  version: OptionalStringSchema,
  localVersion: OptionalStringSchema,
  name: z.string().min(1),
  source: CodexPluginSourceSchema,
  installed: z.boolean(),
  enabled: z.boolean(),
  availability: z.enum(['AVAILABLE', 'DISABLED_BY_ADMIN']),
  interface: CodexPluginInterfaceSchema.nullish(),
  keywords: z.array(z.string().min(1)),
});

const CodexMarketplaceSchema = z.object({
  name: z.string().min(1),
  path: OptionalStringSchema,
  interface: z.object({ displayName: OptionalStringSchema }).nullish(),
  plugins: z.array(CodexPluginSummarySchema),
});

const CodexPluginListSchema = z.object({
  marketplaces: z.array(CodexMarketplaceSchema),
});

const CodexPluginDetailSchema = z.object({
  description: z.string().nullish(),
  skills: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string(),
      enabled: z.boolean(),
    }),
  ),
  hooks: z.array(
    z.object({
      key: z.string().min(1),
      eventName: z.string().min(1),
    }),
  ),
  apps: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().nullish(),
    }),
  ),
  appTemplates: z.array(
    z.object({
      templateId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().nullish(),
    }),
  ),
  mcpServers: z.array(z.string().min(1)),
});

const CodexPluginReadSchema = z.object({ plugin: CodexPluginDetailSchema });

/** `skills/list` entry shape observed live on 0.144.1; tolerant per-entry so one malformed
 * skill never hides the rest. */
const CodexSkillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  path: z.string().min(1),
  scope: z.enum(['repo', 'user']),
  enabled: z.boolean(),
});

const CodexSkillListSchema = z.object({
  data: z.array(
    z.object({
      cwd: z.string().optional(),
      skills: z.array(z.unknown()),
    }),
  ),
});

type CodexMarketplace = z.infer<typeof CodexMarketplaceSchema>;
type CodexPluginSummary = z.infer<typeof CodexPluginSummarySchema>;
type CodexPluginDetail = z.infer<typeof CodexPluginDetailSchema>;

export type CodexPluginServer = Pick<CodexAppServer, 'request' | 'close'>;
export type StartCodexPluginServer = (signal: AbortSignal) => Promise<CodexPluginServer>;

/** Verified live on 0.144.1: `plugin/install`, `plugin/uninstall`, and `config/value/write` back
 * these three. There is no update RPC — a plugin moves version only by re-installing. */
const CODEX_MANAGEMENT_CAPABILITIES = {
  install: true,
  uninstall: true,
  update: false,
  enable: true,
  disable: true,
} as const;

const CodexPluginInstallSchema = z.object({
  appsNeedingAuth: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1) }))
    .default([]),
});

/** Codex plugin discovery over its generated experimental app-server protocol (0.144.1). */
export class CodexPluginAdapter implements PluginProviderAdapter {
  readonly provider = 'codex' as const;

  constructor(private readonly startServer: StartCodexPluginServer = startCodexPluginServer) {}

  async list(opts: PluginDiscoveryOptions = {}): Promise<Plugin[]> {
    return this.withDiscoveryServer(async (server) => {
      const value = await server.request('plugin/list', {
        cwds: opts.cwd ? [opts.cwd] : undefined,
      });
      const catalog = CodexPluginListSchema.parse(value);
      const entries = codexCatalogEntries(catalog);
      // Detail is read for INSTALLED plugins only. `plugin/read` costs ~160ms and the live remote
      // catalog is 2300+ entries, so reading every one blows the discovery deadline (measured on
      // 0.144.1: list 3.3s, one read ~160ms). Market entries keep the summary's own metadata and
      // simply carry no component list.
      const plugins = await Promise.all(
        [...entries.values()].map(async ({ marketplace, summary }) =>
          normalizeCodexPlugin(
            marketplace,
            summary,
            summary.installed
              ? await readCodexPluginDetail(server, marketplace, summary)
              : undefined,
          ),
        ),
      );
      return plugins.sort((left, right) => left.id.localeCompare(right.id));
    });
  }

  async listEnabledMcpServerNames(opts: PluginDiscoveryOptions = {}): Promise<string[]> {
    return this.withDiscoveryServer(async (server) => {
      const catalog = CodexPluginListSchema.parse(
        await server.request('plugin/list', { cwds: opts.cwd ? [opts.cwd] : undefined }),
      );
      const enabled = [...codexCatalogEntries(catalog).values()].filter(
        ({ summary }) => summary.installed && summary.enabled,
      );
      const details = await Promise.all(
        enabled.map(({ marketplace, summary }) =>
          readCodexPluginDetailStrict(server, marketplace, summary),
        ),
      );
      const names = new Set<string>();
      for (const detail of details) {
        for (const name of detail.mcpServers) names.add(name);
      }
      return [...names];
    });
  }

  /** `skills/list` works pre-thread on a discovery-only app-server, accepts omitted `cwds`, and
   * tags every entry with an explicit `scope` (`repo`/`user`) — all verified live on 0.144.1.
   * Plugin-bundled skills arrive in the same response under `plugin:skill` qualified names, so
   * a bare (colon-free) name is what marks a skill standalone. */
  async listStandaloneSkills(opts: PluginDiscoveryOptions = {}): Promise<StandaloneSkill[]> {
    return this.withDiscoveryServer(async (server) => {
      const value = await server.request('skills/list', {
        cwds: opts.cwd ? [opts.cwd] : undefined,
        forceReload: false,
      });
      return normalizeCodexStandaloneSkills(value);
    });
  }

  /**
   * `skills/config/write {path, enabled}` → `{effectiveEnabled}`, persisted as
   * `[[skills.config]]` in config.toml (verified live on 0.144.1). It is a blind write — a
   * nonexistent path still answers success — so the engine's `skills/list` readback is the real
   * check, exactly like `claude plugin enable`.
   */
  async setSkillEnabled(
    skill: SkillToggleTarget,
    enabled: boolean,
    _opts: PluginDiscoveryOptions = {},
  ): Promise<void> {
    await this.withDiscoveryServer(async (server) => {
      await server.request('skills/config/write', { path: skill.path, enabled });
    });
  }

  /**
   * Enablement is not an RPC: it is the config value `plugins."<id>".enabled`, which the app-server
   * writes into `~/.codex/config.toml` (verified live on 0.144.1). The target is resolved through
   * `plugin/installed` first — the cheap installed-only listing — so a caller-supplied string never
   * reaches the TOML key path, and toggling something uninstalled fails here instead of leaving a
   * stray config entry behind. Loaded threads keep their config; the next session sees the change.
   */
  async setPluginEnabled(
    id: string,
    enabled: boolean,
    opts: PluginToggleOptions = {},
  ): Promise<void> {
    await this.withDiscoveryServer(async (server) => {
      const { summary } = await findCodexPlugin(server, 'plugin/installed', id, opts);
      await server.request('config/value/write', {
        // JSON quoting doubles as TOML basic-string quoting; ids carry `@` and are never bare keys.
        keyPath: `plugins.${JSON.stringify(summary.id)}.enabled`,
        value: enabled,
        mergeStrategy: 'upsert',
      });
    });
  }

  async installPlugin(
    id: string,
    opts: PluginDiscoveryOptions = {},
  ): Promise<PluginInstallOutcome> {
    return this.withServer(async (server) => {
      const { marketplace, summary } = await findCodexPlugin(server, 'plugin/list', id, opts);
      const address = codexPluginAddress(marketplace, summary);
      if (!address) throw new Error(`codex: plugin has no installable address: ${id}`);
      const parsed = CodexPluginInstallSchema.parse(
        await server.request('plugin/install', address),
      );
      return { pendingAuthApps: parsed.appsNeedingAuth.map((app) => app.name) };
    });
  }

  async uninstallPlugin(id: string): Promise<void> {
    await this.withServer(async (server) => {
      await server.request('plugin/uninstall', { pluginId: id });
    });
  }

  private async withDiscoveryServer<T>(run: (server: CodexPluginServer) => Promise<T>): Promise<T> {
    return this.withServer(run, DISCOVERY_TIMEOUT_MS);
  }

  private async withServer<T>(
    run: (server: CodexPluginServer) => Promise<T>,
    timeoutMs?: number,
  ): Promise<T> {
    const controller = new AbortController();
    let server: CodexPluginServer | undefined;
    let closed = false;
    const closeOnce = (): void => {
      if (closed || !server) return;
      closed = true;
      server.close();
    };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        controller.abort(new Error('codex: plugin discovery timed out'));
        closeOnce();
      }, timeoutMs);
    }
    try {
      const activeServer = await this.startServer(controller.signal);
      server = activeServer;
      return await run(activeServer);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      closeOnce();
    }
  }
}

/** `plugin/read` and `plugin/install` share one addressing rule: a local marketplace is addressed by
 * file path plus the plugin's local name, a remote one by marketplace name plus its backend id. */
function codexPluginAddress(
  marketplace: CodexMarketplace,
  summary: CodexPluginSummary,
):
  | { pluginName: string; marketplacePath: string }
  | { pluginName: string; remoteMarketplaceName: string }
  | undefined {
  if (marketplace.path) return { pluginName: summary.name, marketplacePath: marketplace.path };
  return summary.remotePluginId
    ? { pluginName: summary.remotePluginId, remoteMarketplaceName: marketplace.name }
    : undefined;
}

async function findCodexPlugin(
  server: CodexPluginServer,
  method: 'plugin/list' | 'plugin/installed',
  id: string,
  opts: PluginDiscoveryOptions,
): Promise<{ marketplace: CodexMarketplace; summary: CodexPluginSummary }> {
  // `plugin/installed` answers the same envelope as `plugin/list`, minus the remote catalog.
  const value = await server.request(method, { cwds: opts.cwd ? [opts.cwd] : undefined });
  for (const marketplace of CodexPluginListSchema.parse(value).marketplaces) {
    const summary = marketplace.plugins.find((plugin) => plugin.id === id);
    if (summary) return { marketplace, summary };
  }
  throw new Error(`codex: ${method} does not list a plugin ${id}`);
}

async function readCodexPluginDetail(
  server: CodexPluginServer,
  marketplace: CodexMarketplace,
  summary: CodexPluginSummary,
): Promise<CodexPluginDetail | undefined> {
  const address = codexPluginAddress(marketplace, summary);
  if (!address) return undefined;

  try {
    return CodexPluginReadSchema.parse(await server.request('plugin/read', address)).plugin;
  } catch {
    return undefined;
  }
}

async function readCodexPluginDetailStrict(
  server: CodexPluginServer,
  marketplace: CodexMarketplace,
  summary: CodexPluginSummary,
): Promise<CodexPluginDetail> {
  const address = codexPluginAddress(marketplace, summary);
  if (!address) throw new Error(`codex: cannot address installed plugin ${summary.id}`);
  return CodexPluginReadSchema.parse(await server.request('plugin/read', address)).plugin;
}

function codexCatalogEntries(catalog: z.infer<typeof CodexPluginListSchema>) {
  // The remote curated catalog can list one id twice; retain the installed copy, else the first.
  const entries = new Map<string, { marketplace: CodexMarketplace; summary: CodexPluginSummary }>();
  for (const marketplace of catalog.marketplaces) {
    for (const summary of marketplace.plugins) {
      const seen = entries.get(summary.id);
      if (seen && !summary.installed) continue;
      entries.set(summary.id, { marketplace, summary });
    }
  }
  return entries;
}

function normalizeCodexStandaloneSkills(value: unknown): StandaloneSkill[] {
  const parsed = CodexSkillListSchema.parse(value);
  const skills = new Map<string, StandaloneSkill>();
  for (const group of parsed.data) {
    for (const raw of group.skills) {
      const entry = CodexSkillEntrySchema.safeParse(raw);
      if (!entry.success) continue;
      const { name, description, path, scope } = entry.data;
      // Plugin-qualified names (`plugin:skill`) belong to Plugin.components, not this list.
      if (name.includes(':') || skills.has(path)) continue;
      skills.set(path, {
        provider: 'codex',
        id: name,
        name,
        description: description || undefined,
        scope: scope === 'repo' ? 'project' : 'user',
        path,
        enabled: entry.data.enabled,
        toggleable: true,
      });
    }
  }
  return [...skills.values()].sort((left, right) => left.id.localeCompare(right.id));
}

async function startCodexPluginServer(signal: AbortSignal): Promise<CodexPluginServer> {
  const binaryPath = agentRuntimeProber.resolveBinary('codex') ?? resolveCodexBinaryPath();
  return CodexAppServer.start({
    binaryPath,
    onNotification: noop,
    onExit: noop,
    signal,
  });
}

function normalizeCodexPlugin(
  marketplace: CodexMarketplace,
  summary: CodexPluginSummary,
  detail: CodexPluginDetail | undefined,
): Plugin {
  const pluginInterface = summary.interface;
  return PluginSchema.parse({
    provider: 'codex',
    id: summary.id,
    name: summary.name,
    displayName: pluginInterface?.displayName ?? undefined,
    description:
      detail?.description ??
      pluginInterface?.shortDescription ??
      pluginInterface?.longDescription ??
      undefined,
    version: summary.version ?? undefined,
    author: pluginInterface?.developerName ? { name: pluginInterface.developerName } : undefined,
    category: pluginInterface?.category ?? undefined,
    keywords: summary.keywords,
    links: codexPluginLinks(pluginInterface),
    marketplace: {
      name: marketplace.name,
      displayName: marketplace.interface?.displayName ?? undefined,
      path: marketplace.path ?? undefined,
    },
    source: normalizeCodexSource(summary.source),
    availability: summary.availability === 'AVAILABLE' ? 'available' : 'blocked',
    installations: summary.installed
      ? [
          {
            enabled: summary.enabled,
            version: summary.localVersion ?? undefined,
            path: summary.source.type === 'local' ? summary.source.path : undefined,
          },
        ]
      : [],
    components: detail ? codexComponents(detail) : [],
    assets: [],
    managementCapabilities: CODEX_MANAGEMENT_CAPABILITIES,
  });
}

function normalizeCodexSource(source: z.infer<typeof CodexPluginSourceSchema>): PluginSource {
  switch (source.type) {
    case 'local':
      return source;
    case 'git':
      return {
        type: 'git',
        url: source.url,
        path: source.path ?? undefined,
        ref: source.refName ?? undefined,
        commit: source.sha ?? undefined,
      };
    case 'npm':
      return {
        type: 'npm',
        package: source.package,
        version: source.version ?? undefined,
        registry: source.registry ?? undefined,
      };
    case 'remote':
      return source;
    default:
      return never(source, 'codex plugin source');
  }
}

function codexPluginLinks(
  pluginInterface: CodexPluginSummary['interface'],
): PluginLinks | undefined {
  if (!pluginInterface) return undefined;
  const links = {
    homepage: pluginInterface.websiteUrl ?? undefined,
    privacyPolicy: pluginInterface.privacyPolicyUrl ?? undefined,
    termsOfService: pluginInterface.termsOfServiceUrl ?? undefined,
  };
  return Object.values(links).some((value) => value !== undefined) ? links : undefined;
}

function codexComponents(detail: CodexPluginDetail): PluginComponent[] {
  const components: PluginComponent[] = [
    ...detail.skills.map((skill) => ({
      kind: 'skill' as const,
      name: skill.name,
      description: skill.description || undefined,
      enabled: skill.enabled,
    })),
    ...detail.hooks.map((hook) => ({
      kind: 'hook' as const,
      name: hook.key,
      description: hook.eventName,
    })),
    ...detail.apps.map((app) => ({
      kind: 'app' as const,
      name: app.name,
      description: app.description ?? undefined,
    })),
    ...detail.appTemplates.map((template) => ({
      kind: 'app-template' as const,
      name: template.name,
      description: template.description ?? undefined,
    })),
    ...detail.mcpServers.map((name) => ({ kind: 'mcp-server' as const, name })),
  ];
  return components.sort((left, right) => {
    const kind = left.kind.localeCompare(right.kind);
    return kind === 0 ? left.name.localeCompare(right.name) : kind;
  });
}
