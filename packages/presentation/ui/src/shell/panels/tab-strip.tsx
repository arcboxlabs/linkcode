import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from 'coss-ui/components/menu';
import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { PanelControlButton, ShellIconButton } from '../shell-control';
import { PanelTabCloseButton } from './panel-tab-close-button';
import type { PanelControl, PanelTab, PanelWindowType } from './vocabulary';
import {
  PANEL_TAB_ACTIVE_CLASSNAME,
  PANEL_TAB_INACTIVE_CLASSNAME,
  PANEL_WINDOW_ICONS,
  PANEL_WINDOW_TYPES,
} from './vocabulary';

export interface PanelTabStripProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  controls?: PanelControl[];
  leading?: React.ReactNode;
  className?: string;
  tabsClassName?: string;
  controlsClassName?: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddWindow: (type: PanelWindowType) => void;
}

const EMPTY_PANEL_CONTROLS: PanelControl[] = [];

export function PanelTabStrip({
  tabs,
  activeTabId,
  controls = EMPTY_PANEL_CONTROLS,
  leading,
  className,
  tabsClassName,
  controlsClassName,
  onSelectTab,
  onCloseTab,
  onAddWindow,
}: PanelTabStripProps): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const tWindow = useTranslations('workbench.panel.window');

  return (
    <div
      className={cn(
        'flex h-10 shrink-0 items-center gap-1 border-border border-b bg-background/95 px-2',
        className,
      )}
    >
      {leading}
      <div className={cn('flex min-w-0 flex-1 items-center gap-1 overflow-x-auto', tabsClassName)}>
        {tabs.map((tab) => (
          <PanelTabButton
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onSelect={() => onSelectTab(tab.id)}
            onClose={() => onCloseTab(tab.id)}
          />
        ))}
        <Menu>
          <MenuTrigger
            render={
              <ShellIconButton label={t('openWindow')}>
                <PlusIcon />
              </ShellIconButton>
            }
          />
          <MenuPopup align="end" className="w-64" side="bottom">
            <MenuGroup>
              <MenuGroupLabel>{t('openWindow')}</MenuGroupLabel>
              {PANEL_WINDOW_TYPES.map((type) => (
                <MenuItem key={type} onClick={() => onAddWindow(type)}>
                  <span className="[&_svg]:size-4">{PANEL_WINDOW_ICONS[type]}</span>
                  <span>{tWindow(type)}</span>
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      </div>
      <div className={cn('flex shrink-0 items-center gap-1', controlsClassName)}>
        {controls.map((control) => (
          <PanelControlButton
            key={control.id}
            label={control.label}
            active={control.active}
            onClick={control.onClick}
          >
            {control.icon}
          </PanelControlButton>
        ))}
      </div>
    </div>
  );
}

function PanelTabButton({
  tab,
  active,
  onSelect,
  onClose,
}: {
  tab: PanelTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const label = useTranslations('workbench.panel.window')(tab.type);
  const closeLabel = t('closeTab', { label });

  return (
    <div
      className={cn(
        'group flex h-6 max-w-44 shrink-0 items-center overflow-hidden rounded-md border text-xs [-webkit-app-region:no-drag]',
        active ? PANEL_TAB_ACTIVE_CLASSNAME : PANEL_TAB_INACTIVE_CLASSNAME,
      )}
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
      >
        <span className="shrink-0 [&_svg]:size-3.5">{PANEL_WINDOW_ICONS[tab.type]}</span>
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <PanelTabCloseButton label={closeLabel} onClick={onClose} />
    </div>
  );
}
