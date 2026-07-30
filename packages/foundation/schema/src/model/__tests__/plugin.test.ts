import { describe, expect, it } from 'vitest';
import { PluginSchema } from '../plugin';

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
