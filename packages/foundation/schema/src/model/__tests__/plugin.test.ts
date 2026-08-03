import { describe, expect, it } from 'vitest';
import {
  InstalledLinkCodePluginSchema,
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
    `skills/latex${String.fromCodePoint(0)}/SKILL.md`,
  ])('rejects unsafe package entry %s', (entry) => {
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
