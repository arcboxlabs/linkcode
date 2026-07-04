import { XIcon } from 'lucide-react';

export interface PanelTabCloseButtonProps {
  label: string;
  onClick: () => void;
}

/** The small "x" affordance inside a closable panel tab; stops the click from also selecting the tab. */
export function PanelTabCloseButton({ label, onClick }: PanelTabCloseButtonProps): React.ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="mr-1 flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-50 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <XIcon className="size-3" />
    </button>
  );
}
