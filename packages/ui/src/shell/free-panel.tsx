import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuShortcut,
  MenuTrigger,
} from 'coss-ui/components/menu';
import { FilesIcon, FileTextIcon, GlobeIcon, PlusIcon, TerminalIcon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { PanelControlButton, ShellIconButton } from './shell-control';

export const PANEL_WINDOW_TYPES = ['review', 'terminal', 'browser', 'files'] as const;

export type PanelWindowType = (typeof PANEL_WINDOW_TYPES)[number];

export interface PanelWindowMeta {
  label: string;
  shortcut?: string;
  icon: ReactNode;
}

export interface PanelTab {
  id: string;
  type: PanelWindowType;
}

export interface PanelControl {
  id: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
}

export interface FreePanelProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  controls?: PanelControl[];
  leading?: ReactNode;
  className?: string;
  stripClassName?: string;
  children: ReactNode;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddWindow: (type: PanelWindowType) => void;
}

export interface PanelTabStripProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  controls?: PanelControl[];
  leading?: ReactNode;
  className?: string;
  tabsClassName?: string;
  controlsClassName?: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddWindow: (type: PanelWindowType) => void;
}

export const PANEL_WINDOW_META: Record<PanelWindowType, PanelWindowMeta> = {
  review: { label: 'Review', icon: <FileTextIcon /> },
  terminal: { label: 'Terminal', icon: <TerminalIcon /> },
  browser: { label: 'Browser', icon: <GlobeIcon /> },
  files: { label: 'Files', icon: <FilesIcon /> },
};

const EMPTY_PANEL_CONTROLS: PanelControl[] = [];

export function FreePanel({
  tabs,
  activeTabId,
  controls = EMPTY_PANEL_CONTROLS,
  leading,
  className,
  stripClassName,
  children,
  onSelectTab,
  onCloseTab,
  onAddWindow,
}: FreePanelProps): ReactNode {
  return (
    <section
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background text-foreground',
        className,
      )}
    >
      <PanelTabStrip
        tabs={tabs}
        activeTabId={activeTabId}
        controls={controls}
        leading={leading}
        className={stripClassName}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onAddWindow={onAddWindow}
      />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

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
}: PanelTabStripProps): ReactNode {
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
              <ShellIconButton label="Open window">
                <PlusIcon />
              </ShellIconButton>
            }
          />
          <MenuPopup align="end" className="w-64" side="bottom">
            <MenuGroup>
              <MenuGroupLabel>Open window</MenuGroupLabel>
              {PANEL_WINDOW_TYPES.map((type) => {
                const meta = PANEL_WINDOW_META[type];
                return (
                  <MenuItem key={type} onClick={() => onAddWindow(type)}>
                    <span className="[&_svg]:size-4">{meta.icon}</span>
                    <span>{meta.label}</span>
                    {meta.shortcut && <MenuShortcut>{meta.shortcut}</MenuShortcut>}
                  </MenuItem>
                );
              })}
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
}): ReactNode {
  const meta = PANEL_WINDOW_META[tab.type];

  return (
    <div
      className={cn(
        'group flex h-7 max-w-44 shrink-0 items-center overflow-hidden rounded-md border text-xs [-webkit-app-region:no-drag]',
        active
          ? 'border-border bg-card font-semibold text-foreground shadow-xs'
          : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
      >
        <span className="shrink-0 [&_svg]:size-3.5">{meta.icon}</span>
        <span className="min-w-0 truncate">{meta.label}</span>
      </button>
      <button
        type="button"
        aria-label={`Close ${meta.label}`}
        title={`Close ${meta.label}`}
        className="mr-1 flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-50 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}

export function PanelStubContent({
  type,
  className,
}: {
  type: PanelWindowType;
  className?: string;
}): ReactNode {
  const meta = PANEL_WINDOW_META[type];

  return (
    <div
      aria-label={`${meta.label} panel stub`}
      className={cn('grid h-full min-h-0 place-items-center bg-background p-4', className)}
    >
      <div className="flex items-center gap-2 rounded-md border border-border border-dashed px-3 py-2 text-muted-foreground text-xs">
        <span className="[&_svg]:size-3.5">{meta.icon}</span>
        <span>{meta.label} stub</span>
      </div>
    </div>
  );
}
