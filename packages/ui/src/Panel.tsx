import type { ReactNode } from 'react';

export interface PanelProps {
  children: ReactNode;
  title?: string;
  className?: string;
}

export function Panel({ children, title, className }: PanelProps): ReactNode {
  return (
    <section
      className={`rounded-lg border border-border bg-surface p-4 text-text ${className ?? ''}`}
    >
      {title ? (
        <header className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {title}
        </header>
      ) : null}
      {children}
    </section>
  );
}
