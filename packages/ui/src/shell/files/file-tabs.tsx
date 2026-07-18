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
    <div
      className={cn(
        // Scrollbar hidden: an overlay bar covers the tabs' bottom border on macOS, and a
        // classic bar would eat into the fixed strip height; trackpad scrolling still works.
        'flex h-9 shrink-0 items-stretch overflow-x-auto bg-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
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
      {/* Continues the strip's bottom border across the empty trailing area. */}
      <div aria-hidden className="flex-1 border-border border-b" />
    </div>
  );
}
