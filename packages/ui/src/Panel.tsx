import type { CSSProperties, ReactNode } from 'react';
import { tokens } from './tokens';

export interface PanelProps {
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
}

export function Panel({ children, title, style }: PanelProps): ReactNode {
  const base: CSSProperties = {
    background: tokens.color.surface,
    border: `1px solid ${tokens.color.border}`,
    borderRadius: tokens.radius.md,
    color: tokens.color.text,
    padding: tokens.space(4),
    ...style,
  };
  return (
    <section style={base}>
      {title ? (
        <header
          style={{
            color: tokens.color.textMuted,
            font: `600 11px ${tokens.font.sans}`,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            marginBottom: tokens.space(3),
          }}
        >
          {title}
        </header>
      ) : null}
      {children}
    </section>
  );
}
