import { McpPluginCatalogSchema } from '@linkcode/schema';

/** Official daemon-owned MCP capability catalog. Managed entries name the server but never carry
 * an HQ/broker endpoint or credential; those are materialized per session by CODE-96. */
export const MCP_PLUGIN_CATALOG = McpPluginCatalogSchema.parse([
  {
    id: 'github-read',
    labelKey: 'units.githubRead.label',
    descriptionKey: 'units.githubRead.description',
    service: 'github',
    backing: { type: 'managed-connector', name: 'linkcode-github' },
  },
]);
