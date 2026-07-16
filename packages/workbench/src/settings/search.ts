import type { SettingsSidebarNavGroup } from '@linkcode/ui';
import { useTranslations } from 'use-intl';
import { matchPaletteCommands } from '../palette/match';

/**
 * Filter grouped settings nav items by query, reusing the palette scorer; display keeps
 * declaration order (ranking is meaningless across groups). Emptied groups are dropped by the nav.
 */
export function filterSettingsNavGroups(
  groups: readonly SettingsSidebarNavGroup[],
  query: string,
): SettingsSidebarNavGroup[] {
  if (query.trim() === '') return [...groups];
  return groups.map((group) => {
    const matched = new Set(matchPaletteCommands(group.items, query));
    return { ...group, items: group.items.filter((item) => matched.has(item)) };
  });
}

export interface SettingsSearchKeywords {
  general: readonly string[];
  appearance: readonly string[];
  terminal: readonly string[];
  notifications: readonly string[];
  connection: readonly string[];
  about: readonly string[];
  agents: readonly string[];
  providers: readonly string[];
  imChannel: readonly string[];
  historyImport: readonly string[];
}

const PROVIDER_SERVICES = [
  'claude-sub',
  'chatgpt-sub',
  'anthropic-api',
  'openai-api',
  'xai',
  'openrouter',
  'vercel-gateway',
  'cloudflare-gateway',
  'custom',
] as const;

/**
 * Per-tab field-level search terms, resolved from the active locale's `settings.*` labels. Apps
 * attach these to their nav items; tabs an app doesn't have are simply never read.
 */
export function useSettingsSearchKeywords(): SettingsSearchKeywords {
  const t = useTranslations('settings');

  return {
    general: [t('general.language'), t('general.languageAuto')],
    appearance: [
      t('appearance.theme'),
      t('appearance.themeSystem'),
      t('appearance.themeLight'),
      t('appearance.themeDark'),
      t('appearance.textSize'),
      t('appearance.reduceMotion'),
      t('appearance.codeThemeLight'),
      t('appearance.codeThemeDark'),
      t('appearance.uiFont'),
      t('appearance.codeFont'),
    ],
    terminal: [t('terminal.fontFamily'), t('terminal.fontSize'), t('terminal.colorScheme')],
    notifications: [
      t('notifications.enable'),
      t('notifications.turnCompleted'),
      t('notifications.awaitingApproval'),
      t('notifications.error'),
    ],
    connection: [t('connection.title'), t('connection.url')],
    about: [t('about.version'), t('about.checkForUpdates')],
    agents: [t('agents.title'), t('agents.enabled')],
    providers: [
      t('providers.title'),
      t('providers.addAccount'),
      t('providers.credentialApiKey'),
      t('providers.endpoint'),
      t('providers.accountModel'),
      ...PROVIDER_SERVICES.map((service) => t(`providers.serviceName.${service}`)),
    ],
    imChannel: [t('imChannel.connectTitle'), t('imChannel.bindings'), t('imChannel.autoMirror')],
    historyImport: [t('historyImport.portalLabel')],
  };
}
