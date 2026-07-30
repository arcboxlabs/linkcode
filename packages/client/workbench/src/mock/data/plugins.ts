import type { Plugin, PluginProviderStatus, StandaloneSkill } from '@linkcode/schema';

/** Canned plugin discovery covering the shapes the settings page must render: an installed and
 * enabled claude plugin with skills + an MCP server, a blocked codex plugin, a marketplace-only
 * (not installed) listing, and a multi-scope install. */
export const SEED_PLUGINS: Plugin[] = [
  {
    provider: 'claude-code',
    id: 'latex@team-tools',
    name: 'latex',
    displayName: 'LaTeX Toolkit',
    description: 'Compile LaTeX documents and preview build artifacts.',
    version: '1.2.3',
    keywords: ['latex', 'pdf'],
    marketplace: { name: 'team-tools', displayName: 'Team Tools' },
    source: { type: 'local', path: '/marketplaces/team-tools/plugins/latex' },
    availability: 'available',
    installations: [
      { enabled: true, version: '1.2.3', scope: 'user' },
      { enabled: false, version: '1.2.0', scope: 'project' },
    ],
    components: [
      { kind: 'skill', name: 'compile-latex', description: 'Compile a LaTeX project to PDF' },
      { kind: 'skill', name: 'bibtex-cleanup', description: 'Normalize BibTeX entries' },
      { kind: 'command', name: 'render' },
      { kind: 'mcp-server', name: 'latex-tools' },
    ],
    assets: [],
    managementCapabilities: {
      install: false,
      uninstall: false,
      update: false,
      enable: true,
      disable: true,
    },
  },
  {
    provider: 'claude-code',
    id: 'reviewer@claude-plugins-official',
    name: 'reviewer',
    description: 'Marketplace listing that has not been installed yet.',
    version: '0.9.0',
    keywords: ['review'],
    marketplace: { name: 'claude-plugins-official' },
    source: { type: 'remote' },
    availability: 'available',
    installations: [],
    components: [{ kind: 'agent', name: 'reviewer' }],
    assets: [],
    managementCapabilities: {
      install: false,
      uninstall: false,
      update: false,
      enable: true,
      disable: true,
    },
  },
  {
    provider: 'codex',
    id: 'search@openai-bundled',
    name: 'search',
    displayName: 'Web Search',
    description: 'Bundled search tools; management is provider-owned.',
    keywords: [],
    marketplace: { name: 'openai-bundled', displayName: 'OpenAI Bundled' },
    source: { type: 'remote' },
    availability: 'blocked',
    installations: [{ enabled: true }],
    components: [
      { kind: 'skill', name: 'web-search', enabled: true },
      { kind: 'mcp-server', name: 'search-tools' },
    ],
    assets: [],
    managementCapabilities: {
      install: false,
      uninstall: false,
      update: false,
      enable: false,
      disable: false,
    },
  },
];

export const SEED_STANDALONE_SKILLS: StandaloneSkill[] = [
  {
    provider: 'claude-code',
    id: 'docx',
    name: 'docx',
    description: 'Create and edit Word documents.',
    scope: 'user',
    path: '/home/user/.claude/skills/docx',
    enabled: true,
    toggleable: true,
  },
  {
    provider: 'codex',
    id: 'linear',
    name: 'linear',
    description: 'Linear workflow conventions.',
    scope: 'project',
    path: '/workspace/.agents/skills/linear/SKILL.md',
    enabled: false,
    toggleable: true,
  },
];

export const SEED_PLUGIN_PROVIDER_STATUS: PluginProviderStatus[] = [
  { provider: 'claude-code', ok: true },
  { provider: 'codex', ok: true },
];
