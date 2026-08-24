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

/** Catalog the mock serves for `plugin-market.refresh`: a settings-bearing MCP plugin (the mail
 * plugin's real env surface as manifest settings) and a skill-only plugin with nothing to configure. */
export const SEED_LINKCODE_RELEASES: MockLinkCodeCatalogEntry[] = [
  {
    pluginId: 'linkcode/mail',
    release: {
      manifest: {
        manifestVersion: 1,
        id: 'linkcode/mail',
        version: '1.0.0',
        displayName: 'Mail (163 / QQ)',
        description: 'Receive and send 163/QQ mail over IMAP + SMTP via an MCP server.',
        keywords: ['mail', '163', 'qq', 'imap', 'smtp'],
        components: [
          {
            kind: 'mcp-server',
            name: 'mail',
            description: 'Mail tools: list/search/read/send messages',
            command: 'node',
            entry: 'dist/index.js',
            env: {
              MAIL_USER: 'account',
              MAIL_PASSWORD: 'password',
              MAIL_PRESET: 'preset',
              MAX_BODY_CHARS: 'maxBodyChars',
            },
          },
        ],
        settings: {
          account: {
            type: 'string',
            label: 'Account',
            description: 'Full email address, e.g. you@163.com',
            required: true,
          },
          password: {
            type: 'password',
            label: 'Authorization code',
            description: 'The IMAP/SMTP authorization code from the mailbox settings page',
            secret: true,
            required: true,
          },
          preset: {
            type: 'enum',
            label: 'Provider preset',
            enum: ['163', 'qq', 'exmail'],
            default: '163',
          },
          maxBodyChars: {
            type: 'number',
            label: 'Max body characters',
            default: 8000,
          },
          readonly: {
            type: 'boolean',
            label: 'Read-only',
            description: 'Expose read tools only; never send or modify mail',
            default: false,
          },
        },
        assets: [],
      },
      artifact: {
        urls: ['plugins/mail-1.0.0.tgz'],
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
