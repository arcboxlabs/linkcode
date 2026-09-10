import { describe, expect, it } from 'vitest';
import {
  InstalledLinkCodePluginSchema,
  LinkCodePluginIntegritySchema,
  LinkCodePluginManifestSchema,
  LinkCodePluginReleaseSchema,
} from '../linkcode-plugin';
import { PluginSchema } from '../plugin';

const latexManifest = {
  manifestVersion: 1,
  id: 'arcbox/latex',
  version: '1.2.0',
  displayName: 'LaTeX',
  description: 'Compile LaTeX documents with a portable Agent Skill.',
  keywords: ['latex', 'pdf'],
  components: [
    {
      kind: 'skill',
      name: 'latex',
      entry: 'skills/latex/SKILL.md',
    },
  ],
  assets: [{ id: { kind: 'tool', name: 'tectonic' }, versionRange: '>=0.16.0 <0.17.0' }],
} as const;

describe('PluginSchema', () => {
  it('keeps Claude Code installation scope separate from enablement', () => {
    expect(
      PluginSchema.parse({
        provider: 'claude-code',
        id: 'formatter@team-tools',
        name: 'formatter',
        version: '1.3.0',
        keywords: [],
        marketplace: { name: 'team-tools' },
        availability: 'available',
        installations: [
          {
            enabled: true,
            version: '1.1.0',
            scope: 'user',
            path: '/plugins/user/formatter',
          },
          {
            enabled: false,
            version: '1.2.0',
            scope: 'project',
            path: '/plugins/project/formatter',
          },
        ],
        components: [
          { kind: 'agent', name: 'reviewer' },
          { kind: 'channel', name: 'notifications' },
        ],
        assets: [],
        managementCapabilities: {
          install: true,
          uninstall: true,
          update: true,
          enable: true,
          disable: true,
        },
      }),
    ).toMatchObject({
      provider: 'claude-code',
      installations: [
        { enabled: true, scope: 'user' },
        { enabled: false, scope: 'project' },
      ],
    });
  });

  it('represents managed runtime dependencies without embedding download instructions', () => {
    expect(
      PluginSchema.parse({
        provider: 'codex',
        id: 'latex@openai',
        name: 'latex',
        displayName: 'LaTeX',
        description: 'Build LaTeX documents',
        version: '2.0.0',
        keywords: ['latex'],
        source: { type: 'remote' },
        availability: 'available',
        installations: [],
        components: [{ kind: 'skill', name: 'latex', enabled: true }],
        assets: [{ id: { kind: 'tool', name: 'tectonic' }, versionRange: '>=0.16.0 <0.17.0' }],
        managementCapabilities: {
          install: true,
          uninstall: true,
          update: false,
          enable: false,
          disable: false,
        },
      }),
    ).toMatchObject({
      provider: 'codex',
      installations: [],
      assets: [{ id: { kind: 'tool', name: 'tectonic' }, versionRange: '>=0.16.0 <0.17.0' }],
    });
  });

  it('requires the assets field even when the provider has none', () => {
    expect(
      PluginSchema.safeParse({
        provider: 'claude-code',
        id: 'minimal@skills-dir',
        name: 'minimal',
        keywords: [],
        availability: 'unknown',
        installations: [{ enabled: true }],
        components: [],
        managementCapabilities: {
          install: true,
          uninstall: true,
          update: true,
          enable: true,
          disable: true,
        },
      }).success,
    ).toBe(false);
  });

  it('rejects agent runtimes as plugin assets', () => {
    expect(
      PluginSchema.safeParse({
        provider: 'codex',
        id: 'invalid@openai',
        name: 'invalid',
        keywords: [],
        availability: 'available',
        installations: [],
        components: [],
        assets: [{ id: { kind: 'agent', name: 'codex' } }],
        managementCapabilities: {
          install: true,
          uninstall: true,
          update: false,
          enable: false,
          disable: false,
        },
      }).success,
    ).toBe(false);
  });

  it('rejects the former string shorthand for tool requirements', () => {
    expect(
      PluginSchema.safeParse({
        provider: 'codex',
        id: 'legacy@openai',
        name: 'legacy',
        keywords: [],
        availability: 'available',
        installations: [],
        components: [],
        assets: [{ id: 'tool:tectonic', versionRange: '>=0.16.0' }],
        managementCapabilities: {
          install: true,
          uninstall: true,
          update: false,
          enable: false,
          disable: false,
        },
      }).success,
    ).toBe(false);
  });

  it('rejects an empty version compatibility range', () => {
    expect(
      PluginSchema.safeParse({
        provider: 'codex',
        id: 'invalid-range@openai',
        name: 'invalid-range',
        keywords: [],
        availability: 'available',
        installations: [],
        components: [],
        assets: [{ id: { kind: 'tool', name: 'tectonic' }, versionRange: '' }],
        managementCapabilities: {
          install: true,
          uninstall: true,
          update: false,
          enable: false,
          disable: false,
        },
      }).success,
    ).toBe(false);
  });
});

describe('LinkCode plugin package contracts', () => {
  it('represents one agent-independent plugin with trusted tool requirements', () => {
    expect(LinkCodePluginManifestSchema.parse(latexManifest)).toMatchObject({
      id: 'arcbox/latex',
      components: [{ kind: 'skill', entry: 'skills/latex/SKILL.md' }],
      assets: [{ id: { kind: 'tool', name: 'tectonic' } }],
    });
  });

  it('keeps provider identity and mutable installation state out of the manifest', () => {
    expect(
      LinkCodePluginManifestSchema.safeParse({
        ...latexManifest,
        provider: 'claude-code',
      }).success,
    ).toBe(false);
    expect(
      LinkCodePluginManifestSchema.safeParse({
        ...latexManifest,
        enabled: true,
      }).success,
    ).toBe(false);
  });

  it.each([
    '../SKILL.md',
    '/skills/latex/SKILL.md',
    String.raw`skills\latex\SKILL.md`,
    'C:/SKILL.md',
    'skills/latex./SKILL.md',
    `skills/latex${String.fromCharCode(0)}/SKILL.md`,
    'skills/latex/readme.md',
    'skills/latex/skill.md',
  ])('rejects invalid skill package entry %s', (entry) => {
    expect(
      LinkCodePluginManifestSchema.safeParse({
        ...latexManifest,
        components: [{ ...latexManifest.components[0], entry }],
      }).success,
    ).toBe(false);
  });

  it.each([
    'arcbox./latex',
    'arcbox/a..b',
    'nul/latex',
    'arcbox/con',
    'arcbox/con.txt',
    'ArcBox/latex',
    `${'a'.repeat(65)}/latex`,
  ])('rejects unsafe plugin id %s', (id) => {
    expect(LinkCodePluginManifestSchema.safeParse({ ...latexManifest, id }).success).toBe(false);
  });

  it('rejects a non-canonical semver release identity', () => {
    expect(
      LinkCodePluginManifestSchema.safeParse({ ...latexManifest, version: '1.2.0-01' }).success,
    ).toBe(false);
  });

  it('accepts hyphens and numeric identifiers in semver build metadata', () => {
    expect(
      LinkCodePluginManifestSchema.safeParse({
        ...latexManifest,
        version: '1.2.0+build-01',
      }).success,
    ).toBe(true);
  });

  it('rejects duplicate component identities', () => {
    expect(
      LinkCodePluginManifestSchema.safeParse({
        ...latexManifest,
        components: [latexManifest.components[0], latexManifest.components[0]],
      }).success,
    ).toBe(false);
  });

  const mailManifest = {
    manifestVersion: 1,
    id: 'linkcode/mail',
    version: '0.1.0',
    keywords: ['mail', 'imap', 'smtp'],
    components: [
      {
        kind: 'mcp-server',
        name: 'mail',
        command: 'node',
        entry: 'dist/index.js',
        env: { MAIL_USER: 'account', MAIL_PASSWORD: 'authcode', MAIL_PRESET: 'preset' },
      },
    ],
    settings: {
      account: { type: 'string', label: 'Email account', required: true },
      authcode: { type: 'password', label: 'Authorization code', secret: true, required: true },
      preset: { type: 'enum', enum: ['163', 'qq', 'exmail'], default: '163' },
    },
    assets: [],
  } as const;

  it('accepts an mcp-server component with declared settings and env bindings', () => {
    expect(LinkCodePluginManifestSchema.safeParse(mailManifest).success).toBe(true);
  });

  it('rejects password settings unless they are routed to the secret vault', () => {
    expect(
      LinkCodePluginManifestSchema.safeParse({
        ...mailManifest,
        settings: {
          ...mailManifest.settings,
          authcode: { ...mailManifest.settings.authcode, secret: false },
        },
      }).success,
    ).toBe(false);
  });

  it.each(['/tmp/index.js', '../dist/index.js', String.raw`dist\index.js`])(
    'rejects a non-package-relative mcp entry %s',
    (entry) => {
      expect(
        LinkCodePluginManifestSchema.safeParse({
          ...mailManifest,
          components: [{ ...mailManifest.components[0], entry }],
        }).success,
      ).toBe(false);
    },
  );

  it('rejects a dotted mcp-server name, which would collide as a provider config key', () => {
    expect(
      LinkCodePluginManifestSchema.safeParse({
        ...mailManifest,
        components: [{ ...mailManifest.components[0], name: 'mail.server' }],
      }).success,
    ).toBe(false);
  });

  it('rejects an mcp-server env binding to an undeclared setting', () => {
    expect(
      LinkCodePluginManifestSchema.safeParse({
        ...mailManifest,
        components: [{ ...mailManifest.components[0], env: { MAIL_USER: 'missingSetting' } }],
      }).success,
    ).toBe(false);
  });

  it('rejects an enum setting without options and a non-enum setting carrying options', () => {
    expect(
      LinkCodePluginManifestSchema.safeParse({
        ...mailManifest,
        settings: { ...mailManifest.settings, preset: { type: 'enum' } },
      }).success,
    ).toBe(false);
    expect(
      LinkCodePluginManifestSchema.safeParse({
        ...mailManifest,
        settings: { ...mailManifest.settings, account: { type: 'string', enum: ['a'] } },
      }).success,
    ).toBe(false);
  });

  it("rejects a default that does not match the setting's type", () => {
    const accepts = (field: unknown) =>
      LinkCodePluginManifestSchema.safeParse({
        ...mailManifest,
        settings: { ...mailManifest.settings, flag: field },
      }).success;
    expect(accepts({ type: 'boolean', default: 'false' })).toBe(false);
    expect(accepts({ type: 'number', default: true })).toBe(false);
    expect(accepts({ type: 'string', default: 42 })).toBe(false);
    expect(accepts({ type: 'enum', enum: ['163', 'qq'], default: 'gmail' })).toBe(false);
    expect(accepts({ type: 'boolean', default: true })).toBe(true);
    expect(accepts({ type: 'number', default: 42 })).toBe(true);
    expect(accepts({ type: 'enum', enum: ['163', 'qq'], default: 'qq' })).toBe(true);
  });

  it('the forward-compatible reader strips unknown mcp-server component keys', () => {
    expect(
      LinkCodePluginReleaseSchema.parse({
        manifest: {
          ...mailManifest,
          components: [{ ...mailManifest.components[0], futureComponentMetadata: 'ignored' }],
          futureManifestMetadata: 'ignored',
        },
        artifact: {
          urls: ['releases/linkcode-mail-0.1.0.tgz'],
          integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
          format: 'tgz',
        },
      }),
    ).toMatchObject({ manifest: { id: 'linkcode/mail', version: '0.1.0' } });
  });

  it('continues to reject agent runtimes as plugin assets', () => {
    expect(
      LinkCodePluginManifestSchema.safeParse({
        ...latexManifest,
        assets: [{ id: { kind: 'agent', name: 'codex' } }],
      }).success,
    ).toBe(false);
  });

  it('pins immutable marketplace package bytes with SRI integrity', () => {
    expect(
      LinkCodePluginReleaseSchema.parse({
        manifest: {
          ...latexManifest,
          components: [
            {
              ...latexManifest.components[0],
              futureComponentMetadata: 'ignored by older readers',
            },
          ],
          futureManifestMetadata: 'ignored by older readers',
        },
        artifact: {
          urls: ['releases/arcbox-latex-1.2.0.tgz'],
          integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
          size: 4096,
          format: 'tgz',
        },
        publishedAt: '2026-08-03T00:00:00.000Z',
        deprecated: false,
      }),
    ).toMatchObject({ manifest: { id: 'arcbox/latex', version: '1.2.0' } });
  });

  it('rejects marketplace releases without parseable integrity', () => {
    expect(
      LinkCodePluginReleaseSchema.safeParse({
        manifest: latexManifest,
        artifact: {
          urls: ['https://plugins.linkcode.ai/arcbox/latex/1.2.0.tgz'],
          integrity: '7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
          format: 'tgz',
        },
      }).success,
    ).toBe(false);
  });

  it.each([
    'sha256-A',
    'sha256-Zg==',
    `sha256-${'A'.repeat(43)}`,
    `sha256-${'A'.repeat(42)}B=`,
    `sha384-${'A'.repeat(44)}`,
    `sha512-${'A'.repeat(64)}`,
  ])('rejects non-canonical or incorrectly sized SRI digest %s', (integrity) => {
    expect(LinkCodePluginIntegritySchema.safeParse(integrity).success).toBe(false);
  });

  it('accepts canonical digests with the size required by each SRI algorithm', () => {
    expect(
      LinkCodePluginIntegritySchema.safeParse(
        [
          `sha256-${'A'.repeat(43)}=`,
          `sha384-${'A'.repeat(64)}`,
          `sha512-${'A'.repeat(86)}==`,
        ].join(' '),
      ).success,
    ).toBe(true);
  });

  it('rejects non-HTTPS absolute artifact URLs', () => {
    expect(
      LinkCodePluginReleaseSchema.safeParse({
        manifest: latexManifest,
        artifact: {
          urls: ['http://plugins.linkcode.ai/arcbox/latex/1.2.0.tgz'],
          integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
          format: 'tgz',
        },
      }).success,
    ).toBe(false);
  });

  it('stores mutable local state separately with marketplace provenance', () => {
    expect(
      InstalledLinkCodePluginSchema.parse({
        id: 'arcbox/latex',
        version: '1.2.0',
        marketplaceId: 'linkcode-official',
        integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
        enabled: true,
        path: '/home/user/.linkcode/plugins/arcbox/latex/1.2.0',
        futureStoreMetadata: 'ignored by older readers',
      }),
    ).toEqual({
      id: 'arcbox/latex',
      version: '1.2.0',
      marketplaceId: 'linkcode-official',
      integrity: 'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
      enabled: true,
      path: '/home/user/.linkcode/plugins/arcbox/latex/1.2.0',
    });
  });
});
