import { Maximize2Icon, Minimize2Icon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { PanelControlButton } from '../shell-control';
import type { PanelControl } from './vocabulary';

/** The maximize/restore control shown in a panel's chrome-integrated header. */
export function PanelContextualControls({
  maximized,
  onToggleMax,
}: {
  maximized: boolean;
  onToggleMax: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const controls: PanelControl[] = [
    {
      id: 'max',
      label: maximized ? t('restore') : t('fullscreen'),
      icon: maximized ? <Minimize2Icon /> : <Maximize2Icon />,
      active: maximized,
      onClick: onToggleMax,
    },
  ];

  return (
    <div className="flex h-full shrink-0 items-center gap-1">
      {controls.map((control) => (
        <PanelControlButton
          key={control.id}
          label={control.label}
          active={control.active}
          data-pressed={control.active ? '' : undefined}
          className={
            control.active
              ? 'bg-info/10 text-info-foreground hover:bg-info/15 hover:text-info-foreground'
              : undefined
          }
          onClick={control.onClick}
        >
          {control.icon}
        </PanelControlButton>
      ))}
    </div>
  );
}
