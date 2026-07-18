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
    // Same no-scroll fill model as FileTabStrip; the + button keeps its natural width and
    // the tabs split the rest.
    <div
      className={cn('flex h-8 shrink-0 items-stretch border-border border-b bg-muted', className)}
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
      <div className="flex shrink-0 items-center px-1">
        <ShellIconButton label={t('newTerminalTab')} onClick={onAddTab}>
          <PlusIcon />
        </ShellIconButton>
      </div>
    </div>
  );
}
