import type { TokenUsage } from '@linkcode/schema';
import { MinusIcon, SquareIcon, XIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslations } from 'use-intl';
import type { WorkbenchSystemBridge } from './types';

export interface TopBarProps {
  title: string;
  subtitle?: string;
  usage?: TokenUsage | null;
  systemBridge?: WorkbenchSystemBridge;
}

/** Slim header: active-session identity, token usage, and (on desktop) window controls. */
export function TopBar({ title, subtitle, usage, systemBridge }: TopBarProps): ReactElement {
  const t = useTranslations('workbench.usage');
  const win = systemBridge?.window;
  const hasUsage = usage != null && (usage.inputTokens != null || usage.outputTokens != null);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 [-webkit-app-region:drag]">
      <div className="min-w-0">
        <div className="truncate font-medium text-[13px] text-foreground">{title}</div>
        {subtitle && <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2 [-webkit-app-region:no-drag]">
        {hasUsage && (
          <span className="text-[11px] text-muted-foreground">
            {t('tokens', { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 })}
          </span>
        )}
        {win && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Minimize"
              onClick={win.minimize}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <MinusIcon className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label="Maximize"
              onClick={win.toggleMaximize}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <SquareIcon className="size-3" />
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={win.close}
              className="rounded p-1 text-muted-foreground hover:bg-destructive hover:text-white"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
