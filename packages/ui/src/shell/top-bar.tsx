import type { TokenUsage } from '@linkcode/schema';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';

export interface TopBarProps {
  title: string;
  subtitle?: string;
  usage?: TokenUsage | null;
  className?: string;
  trailing?: ReactNode;
}

/** Slim shared header: active-session identity, token usage, and app-supplied trailing controls. */
export function TopBar({ title, subtitle, usage, className, trailing }: TopBarProps): ReactNode {
  const t = useTranslations('workbench.usage');
  const hasUsage = usage != null && (usage.inputTokens != null || usage.outputTokens != null);

  return (
    <header
      className={cn('flex h-12 shrink-0 items-center gap-3 border-b border-border px-4', className)}
    >
      <div className="min-w-0">
        <div className="truncate font-medium text-[13px] text-foreground">{title}</div>
        {subtitle && <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {hasUsage && (
          <span className="text-[11px] text-muted-foreground">
            {t('tokens', { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 })}
          </span>
        )}
        {trailing}
      </div>
    </header>
  );
}
