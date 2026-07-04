import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { ShellIconButton } from '../shell-control';
import { PanelTabCloseButton } from './panel-tab-close-button';
import type { PanelSectionTab } from './vocabulary';
import {
  PANEL_TAB_ACTIVE_CLASSNAME,
  PANEL_TAB_INACTIVE_CLASSNAME,
  PANEL_WINDOW_ICONS,
} from './vocabulary';

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
        'flex h-8 shrink-0 items-center gap-1 border-border border-b bg-background/60 px-2',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map((tab, index) => {
          const label = `${terminalLabel} ${index + 1}`;
          return (
            <SectionTerminalTabButton
              key={tab.id}
              label={label}
              active={tab.id === activeTabId}
              closeLabel={t('closeTab', { label })}
              onSelect={() => onSelectTab(tab.id)}
              onClose={() => onCloseTab(tab.id)}
            />
          );
        })}
        <ShellIconButton label={t('newTerminalTab')} onClick={onAddTab}>
          <PlusIcon />
        </ShellIconButton>
      </div>
    </div>
  );
}

function SectionTerminalTabButton({
  label,
  active,
  closeLabel,
  onSelect,
  onClose,
}: {
  label: string;
  active: boolean;
  closeLabel: string;
  onSelect: () => void;
  onClose: () => void;
}): React.ReactNode {
  return (
    <div
      className={cn(
        'group flex h-7 max-w-40 shrink-0 items-center overflow-hidden rounded-md border text-xs [-webkit-app-region:no-drag]',
        active ? PANEL_TAB_ACTIVE_CLASSNAME : PANEL_TAB_INACTIVE_CLASSNAME,
      )}
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
      >
        <span className="shrink-0 [&_svg]:size-3.5">{PANEL_WINDOW_ICONS.terminal}</span>
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <PanelTabCloseButton label={closeLabel} onClick={onClose} />
    </div>
  );
}
