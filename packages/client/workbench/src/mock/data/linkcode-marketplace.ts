import type { LinkCodeMarketplaceConfig, LinkCodePluginRelease } from '@linkcode/schema';

/** The mock LinkCode marketplace: one configured index whose catalog the mock "refresh" serves. */
export const SEED_LINKCODE_MARKETPLACES: LinkCodeMarketplaceConfig[] = [
  {
    id: 'linkcode-official',
    displayName: 'LinkCode Official',
    source: { type: 'remote', url: 'https://plugins.linkcode.ai/index.json' },
    enabled: true,
  },
];

export interface MockLinkCodeCatalogEntry {
  pluginId: string;
  release: LinkCodePluginRelease;
}

/** Catalog the mock serves for `plugin-market.refresh`: a settings-bearing MCP plugin (the echo
 * debug plugin's env surface, exercising every settings field type) and a skill-only plugin that
 * the catalog boundary filters out — the mock mirrors the daemon, so it is never listed or
 * installable. */
export const SEED_LINKCODE_RELEASES: MockLinkCodeCatalogEntry[] = [
  {
    pluginId: 'linkcode/echo',
    release: {
      manifest: {
        manifestVersion: 1,
        id: 'linkcode/echo',
        version: '0.1.0',
        displayName: 'Echo',
        description: 'Echoes text back over a stdio MCP server; a marketplace debug fixture.',
        keywords: ['echo', 'debug', 'marketplace'],
        components: [
          {
            kind: 'mcp-server',
            name: 'echo',
            description: 'Echo tool: returns the input text, optionally uppercased',
            command: 'node',
            entry: 'dist/index.js',
            env: {
              ECHO_GREETING: 'greeting',
              ECHO_TOKEN: 'token',
              ECHO_MODE: 'mode',
              ECHO_MAX_CHARS: 'maxChars',
              ECHO_PREVIEW: 'preview',
            },
          },
        ],
        settings: {
          greeting: {
            type: 'string',
            label: 'Greeting',
            description: 'Prefix prepended to every echoed text',
            required: true,
          },
          token: {
            type: 'password',
            label: 'Token',
            description: 'Only exercised to prove secret fields land in the vault',
            secret: true,
            required: true,
          },
          mode: {
            type: 'enum',
            label: 'Mode',
            enum: ['plain', 'shout'],
            default: 'plain',
          },
          maxChars: {
            type: 'number',
            label: 'Max echo characters',
            default: 1000,
          },
          preview: {
            type: 'boolean',
            label: 'Preview',
            description: 'Log every echo to stdout as well',
            default: false,
          },
        },
        assets: [],
      },
      artifact: {
        urls: ['plugins/echo-0.1.0.tgz'],
        integrity: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        format: 'tgz',
      },
      publishedAt: '2026-08-01T00:00:00Z',
    },
  },
  {
    pluginId: 'linkcode/notes',
    release: {
      manifest: {
        manifestVersion: 1,
        id: 'linkcode/notes',
        version: '0.2.0',
        displayName: 'Notes',
        description: 'A skill-only plugin with no configurable settings.',
        keywords: ['notes'],
        components: [
          {
            kind: 'skill',
            name: 'notes',
            description: 'Capture and search notes',
            entry: 'skills/notes/SKILL.md',
          },
        ],
        assets: [],
      },
      artifact: {
        urls: ['plugins/notes-0.2.0.tgz'],
        integrity: 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        format: 'tgz',
      },
    },
  },
];
