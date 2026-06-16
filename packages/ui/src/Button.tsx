import type { CSSProperties, ReactNode } from 'react';
import { tokens } from './tokens';

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
}: ButtonProps): ReactNode {
  const style: CSSProperties = {
    appearance: 'none',
    border: `1px solid ${variant === 'primary' ? tokens.color.accent : tokens.color.border}`,
    background: variant === 'primary' ? tokens.color.accent : 'transparent',
    color: variant === 'primary' ? tokens.color.bg : tokens.color.text,
    borderRadius: tokens.radius.sm,
    padding: `${tokens.space(2)}px ${tokens.space(3)}px`,
    font: `500 13px ${tokens.font.sans}`,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
  return (
    <button type="button" style={style} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
