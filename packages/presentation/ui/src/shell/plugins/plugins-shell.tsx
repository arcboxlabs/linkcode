import { Button } from 'coss-ui/components/button';
import { Input } from 'coss-ui/components/input';
import { Tabs, TabsList, TabsPanel, TabsTab } from 'coss-ui/components/tabs';
import { RefreshCwIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';

export interface PluginsShellProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  /** Discovery re-run; disabled while one is in flight (a real CLI shell-out on the daemon). */
  onRefresh: () => void;
  refreshing: boolean;
  pluginsTab: React.ReactNode;
  marketTab: React.ReactNode;
  mcpTab: React.ReactNode;
  skillsTab: React.ReactNode;
}

/** The plugins/MCP/skills settings page frame: title, search, manual refresh, three tabs. */
export function PluginsShell({
  searchQuery,
  onSearchChange,
  onRefresh,
  refreshing,
  pluginsTab,
  marketTab,
  mcpTab,
  skillsTab,
}: PluginsShellProps): React.ReactNode {
  const t = useTranslations('settings.plugins');
  return (
    // No page title here: the settings frame renders the tab title above every panel.
    <div className="flex flex-col">
      <p className="mb-6 text-muted-foreground text-sm">{t('hint')}</p>
      <Tabs defaultValue="plugins">
        <div className="mb-3 flex items-center justify-between gap-3">
          <TabsList>
            <TabsTab value="plugins">{t('tabPlugins')}</TabsTab>
            <TabsTab value="market">{t('tabMarket')}</TabsTab>
            <TabsTab value="mcp">{t('tabMcp')}</TabsTab>
            <TabsTab value="skills">{t('tabSkills')}</TabsTab>
          </TabsList>
          <div className="flex items-center gap-2">
            <Input
              className="h-8 w-56"
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={(event) => onSearchChange(event.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={onRefresh}
              aria-label={t('refresh')}
            >
              <RefreshCwIcon className={cn('size-4', refreshing && 'animate-spin')} />
            </Button>
          </div>
        </div>
        <TabsPanel value="plugins">{pluginsTab}</TabsPanel>
        <TabsPanel value="market">{marketTab}</TabsPanel>
        <TabsPanel value="mcp">{mcpTab}</TabsPanel>
        <TabsPanel value="skills">{skillsTab}</TabsPanel>
      </Tabs>
    </div>
  );
}
