import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import { PanelTabStrip } from './tab-strip';
import type { PanelControl, PanelTab, PanelWindowType } from './vocabulary';
import { PANEL_WINDOW_ICONS } from './vocabulary';

export interface FreePanelProps {
  tabs: PanelTab[];
  activeTabId: string | null;
  controls?: PanelControl[];
  leading?: React.ReactNode;
  className?: string;
  stripClassName?: string;
  children: React.ReactNode;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddWindow: (type: PanelWindowType) => void;
}

export function FreePanel({
  tabs,
  activeTabId,
  controls,
  leading,
  className,
  stripClassName,
  children,
  onSelectTab,
  onCloseTab,
  onAddWindow,
}: FreePanelProps): React.ReactNode {
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

export function PanelStubContent({
  type,
  className,
}: {
  type: PanelWindowType;
  className?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const label = useTranslations('workbench.panel.window')(type);
  const stubLabel = t('stub', { label });

  return (
    <div
      aria-label={stubLabel}
      className={cn('grid h-full min-h-0 place-items-center bg-background p-4', className)}
    >
      <div className="flex items-center gap-2 rounded-md border border-border border-dashed px-3 py-2 text-muted-foreground text-xs">
        <span className="[&_svg]:size-3.5">{PANEL_WINDOW_ICONS[type]}</span>
        <span>{stubLabel}</span>
      </div>
    </div>
  );
}
