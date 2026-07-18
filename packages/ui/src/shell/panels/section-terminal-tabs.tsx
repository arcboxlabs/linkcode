import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { ShellIconButton } from '../shell-control';
import { SectionTabButton } from './section-tab-button';
import type { PanelSectionTab } from './vocabulary';
import { PANEL_WINDOW_ICONS } from './vocabulary';

/** The terminal section's own sub-tab strip, one tab per PTY instance. */
export function SectionTerminalTabStrip({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onAddTab,
  className,
}: {
  tabs: PanelSectionTab[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  className?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const terminalLabel = useTranslations('workbench.panel.window')('terminal');

  return (
    <div
      className={cn(
        // Same hidden-scrollbar + snap treatment as FileTabStrip: scrollbars would cover the
        // border or steal height, and mandatory snap keeps rest positions on tab edges.
        'flex h-8 shrink-0 snap-x snap-mandatory items-stretch overflow-x-auto bg-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {tabs.map((tab, index) => {
        const label = `${terminalLabel} ${index + 1}`;
        return (
          <SectionTabButton
            key={tab.id}
            label={label}
            icon={PANEL_WINDOW_ICONS.terminal}
            active={tab.id === activeTabId}
            closeLabel={t('closeTab', { label })}
            onSelect={() => onSelectTab(tab.id)}
            onClose={() => onCloseTab(tab.id)}
          />
        );
      })}
      {/* Trailing area carries the + button and continues the strip's bottom border;
          snap-end makes the fully-scrolled position (+ visible) a valid snap rest. */}
      <div className="flex flex-1 snap-end items-center border-border border-b px-1">
        <ShellIconButton label={t('newTerminalTab')} onClick={onAddTab}>
          <PlusIcon />
        </ShellIconButton>
      </div>
    </div>
  );
}
