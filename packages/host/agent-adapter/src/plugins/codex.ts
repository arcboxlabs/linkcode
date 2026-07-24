import type { Plugin, PluginComponent, PluginLinks, PluginSource } from '@linkcode/schema';
import { PluginSchema } from '@linkcode/schema';
import { never } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { z } from 'zod';
import { CodexAppServer, resolveCodexBinaryPath } from '../native/codex/app-server';
import { agentRuntimeProber } from '../probe';
import type { PluginDiscoveryOptions, PluginProviderAdapter } from './adapter';

const OptionalStringSchema = z.string().min(1).nullable();
const OptionalUrlSchema = z.url().nullable().catch(null);
const OptionalHttpUrlSchema = z.httpUrl().nullable().catch(null);
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
  shortDescription: z.string().nullable(),
  longDescription: z.string().nullable(),
  developerName: OptionalStringSchema,
  category: OptionalStringSchema,
  capabilities: z.array(z.string()),
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
  interface: CodexPluginInterfaceSchema.nullable(),
  keywords: z.array(z.string().min(1)),
});

const CodexMarketplaceSchema = z.object({
  name: z.string().min(1),
  path: OptionalStringSchema,
  interface: z.object({ displayName: OptionalStringSchema }).nullable(),
  plugins: z.array(CodexPluginSummarySchema),
});

const CodexPluginListSchema = z.object({
  marketplaces: z.array(CodexMarketplaceSchema),
});

const CodexPluginDetailSchema = z.object({
  description: z.string().nullable(),
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
      description: z.string().nullable(),
    }),
  ),
  appTemplates: z.array(
    z.object({
      templateId: z.string().min(1),
      name: z.string().min(1),
      description: z.string().nullable(),
    }),
  ),
  mcpServers: z.array(z.string().min(1)),
});

const CodexPluginReadSchema = z.object({ plugin: CodexPluginDetailSchema });

type CodexMarketplace = z.infer<typeof CodexMarketplaceSchema>;
type CodexPluginSummary = z.infer<typeof CodexPluginSummarySchema>;
type CodexPluginDetail = z.infer<typeof CodexPluginDetailSchema>;

export type CodexPluginServer = Pick<CodexAppServer, 'request' | 'close'>;
export type StartCodexPluginServer = () => Promise<CodexPluginServer>;

const CODEX_MANAGEMENT_CAPABILITIES = {
  install: true,
  uninstall: true,
  update: false,
  enable: false,
  disable: false,
} as const;

/** Codex plugin discovery over its generated experimental app-server protocol (0.144.1). */
export class CodexPluginAdapter implements PluginProviderAdapter {
  readonly provider = 'codex' as const;

  constructor(private readonly startServer: StartCodexPluginServer = startCodexPluginServer) {}

  async list(opts: PluginDiscoveryOptions = {}): Promise<Plugin[]> {
    const server = await this.startServer();
    const timeout = setTimeout(() => server.close(), DISCOVERY_TIMEOUT_MS);
    try {
      const value = await server.request('plugin/list', {
        cwds: opts.cwd ? [opts.cwd] : undefined,
      });
      const catalog = CodexPluginListSchema.parse(value);
      const entries = catalog.marketplaces.flatMap((marketplace) =>
        marketplace.plugins.map((summary) => ({ marketplace, summary })),
      );
      const plugins = await Promise.all(
        entries.map(async ({ marketplace, summary }) =>
          normalizeCodexPlugin(
            marketplace,
            summary,
            await readCodexPluginDetail(server, marketplace, summary),
          ),
        ),
      );
      return plugins.sort((left, right) => left.id.localeCompare(right.id));
    } finally {
      clearTimeout(timeout);
      server.close();
    }
  }
}

async function readCodexPluginDetail(
  server: CodexPluginServer,
  marketplace: CodexMarketplace,
  summary: CodexPluginSummary,
): Promise<CodexPluginDetail | undefined> {
  const pluginName = marketplace.path ? summary.name : summary.remotePluginId;
  if (!pluginName) return undefined;

  try {
    const detailValue = await server.request('plugin/read', {
      pluginName,
      ...(marketplace.path
        ? { marketplacePath: marketplace.path }
        : { remoteMarketplaceName: marketplace.name }),
    });
    return CodexPluginReadSchema.parse(detailValue).plugin;
  } catch {
    return undefined;
  }
}

async function startCodexPluginServer(): Promise<CodexPluginServer> {
  const binaryPath = agentRuntimeProber.resolveBinary('codex') ?? resolveCodexBinaryPath();
  return CodexAppServer.start({
    binaryPath,
    onNotification: noop,
    onExit: noop,
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
