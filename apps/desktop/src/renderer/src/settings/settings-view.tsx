import { Button } from 'coss-ui/components/button';
import { Tabs, TabsList, TabsPanel, TabsTab } from 'coss-ui/components/tabs';
import { XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useTranslations } from 'use-intl';
import { useDesktopAppConfig } from '../app-config-context';
import { AboutTab } from './about-tab';
import { AgentsTab } from './agents-tab';
import { ConnectionTab } from './connection-tab';
import { GeneralTab } from './general-tab';

function isMacOS(): boolean {
  return navigator.platform.toLowerCase().includes('mac');
}

/**
 * Full-page Settings surface. Rendered above the connection gate so it stays reachable even when the
 * daemon is unreachable (needed to fix a bad daemon URL). The workbench stays mounted underneath.
 */
export function SettingsView(): ReactNode {
  const t = useTranslations('settings');
  const { closeSettings } = useDesktopAppConfig();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeSettings]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      <header
        className="flex h-12 shrink-0 items-center gap-2 border-border border-b px-4 [-webkit-app-region:drag]"
        style={isMacOS() ? { paddingLeft: 80 } : undefined}
      >
        <span className="font-semibold text-sm">{t('title')}</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto [-webkit-app-region:no-drag]"
          onClick={closeSettings}
        >
          <XIcon />
          {t('done')}
        </Button>
      </header>

      <Tabs defaultValue="general" orientation="vertical" className="min-h-0 flex-1 gap-0">
        <TabsList
          variant="underline"
          className="w-48 shrink-0 items-stretch gap-1 border-border border-r p-3"
        >
          <TabsTab value="general">{t('tabs.general')}</TabsTab>
          <TabsTab value="connection">{t('tabs.connection')}</TabsTab>
          <TabsTab value="about">{t('tabs.about')}</TabsTab>
          <TabsTab value="agents">{t('tabs.agents')}</TabsTab>
        </TabsList>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl p-6">
            <TabsPanel value="general">
              <GeneralTab />
            </TabsPanel>
            <TabsPanel value="connection">
              <ConnectionTab />
            </TabsPanel>
            <TabsPanel value="about">
              <AboutTab />
            </TabsPanel>
            <TabsPanel value="agents">
              <AgentsTab />
            </TabsPanel>
          </div>
        </div>
      </Tabs>
    </div>
  );
}
