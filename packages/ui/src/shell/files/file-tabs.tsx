import { useTranslations } from 'use-intl';
import { fileBasename } from '../../chat/artifacts';
import { cn } from '../../lib/cn';
import { SectionTabButton } from '../panels/section-tab-button';
import { PANEL_WINDOW_ICONS } from '../panels/vocabulary';

export interface FileTab {
  id: string;
  path: string;
}

/** The files section's sub-tab strip, one tab per open file. */
export function FileTabStrip({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  className,
}: {
  tabs: FileTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  className?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');

  return (
    // No scrolling: tabs divide the width equally and shrink together, so none can end up
    // clipped against the tree divider (the strip's own border-b is the band's line).
    <div
      className={cn('flex h-8 shrink-0 items-stretch border-border border-b bg-muted', className)}
    >
      {tabs.map((tab) => {
        const label = fileBasename(tab.path);
        return (
          <SectionTabButton
            key={tab.id}
            label={label}
            title={tab.path}
            icon={PANEL_WINDOW_ICONS.files}
            active={tab.id === activeTabId}
            closeLabel={t('closeTab', { label })}
            onSelect={() => onSelectTab(tab.id)}
            onClose={() => onCloseTab(tab.id)}
          />
        );
      })}
    </div>
  );
}
