import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { ShellIconButton } from '../shell-control';
import { SectionTabButton } from './section-tab-button';
import type { BrowserPanelSectionTab } from './vocabulary';
import { PANEL_WINDOW_ICONS } from './vocabulary';

/** The browser section's own sub-tab strip, one tab per webview instance. */
export function SectionBrowserTabStrip({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTab,
  className,
}: {
  tabs: BrowserPanelSectionTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  className?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const browserLabel = useTranslations('workbench.panel.window')('browser');

  return (
    <div
      className={cn(
        'flex h-8 shrink-0 items-center gap-1 border-border border-b bg-background/60 px-2',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab, index) => {
          const fallback = `${browserLabel} ${index + 1}`;
          const label = tab.title !== null && tab.title.length > 0 ? tab.title : fallback;
          return (
            <SectionTabButton
              key={tab.id}
              label={label}
              title={label}
              icon={PANEL_WINDOW_ICONS.browser}
              active={tab.id === activeTabId}
              closeLabel={t('closeTab', { label })}
              onSelect={() => onSelectTab(tab.id)}
              onClose={() => onCloseTab(tab.id)}
            />
          );
        })}
        <ShellIconButton label={t('newBrowserTab')} onClick={onAddTab}>
          <PlusIcon />
        </ShellIconButton>
      </div>
    </div>
  );
}
