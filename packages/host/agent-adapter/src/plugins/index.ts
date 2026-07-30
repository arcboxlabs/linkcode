import type { PluginProvider } from '@linkcode/schema';
import { never } from 'foxts/guard';
import type { PluginProviderAdapter } from './adapter';
import { ClaudeCodePluginAdapter } from './claude-code';
import { CodexPluginAdapter } from './codex';

export type {
  PluginDiscoveryOptions,
  PluginProviderAdapter,
  PluginProviderAdapterFactory,
  PluginToggleOptions,
} from './adapter';
export { ClaudeCodePluginAdapter } from './claude-code';
export { CodexPluginAdapter } from './codex';

/** The only provider-plugin factory; upper layers never branch on native formats. */
export function createPluginProviderAdapter(provider: PluginProvider): PluginProviderAdapter {
  switch (provider) {
    case 'claude-code':
      return new ClaudeCodePluginAdapter();
    case 'codex':
      return new CodexPluginAdapter();
    default:
      return never(provider, 'plugin provider');
  }
}
