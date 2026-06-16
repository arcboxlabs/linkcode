import type { ReactNode } from 'react';

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
}

const VARIANTS = {
  primary: 'border-accent bg-accent text-bg hover:opacity-90',
  ghost: 'border-border bg-transparent text-text hover:bg-white/5',
} as const;

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
}: ButtonProps): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-md border px-3 py-2 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]}`}
    >
      {children}
    </button>
  );
}
