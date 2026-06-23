import type { TokenUsage } from '@linkcode/schema';
import { noop } from 'foxact/noop';
import { useEffect } from 'foxact/use-abortable-effect';
import { Minimize2Icon, MinusIcon, SquareIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import type { WorkbenchSystemBridge } from './types';

type WindowControlsMode = 'none' | 'native-macos' | 'custom';

export interface TopBarProps {
  title: string;
  subtitle?: string;
  usage?: TokenUsage | null;
  systemBridge?: WorkbenchSystemBridge;
}

/** Slim header: active-session identity, token usage, and (on desktop) window controls. */
export function TopBar({ title, subtitle, usage, systemBridge }: TopBarProps): ReactNode {
  const t = useTranslations('workbench.usage');
  const win = systemBridge?.window;
  const hasUsage = usage != null && (usage.inputTokens != null || usage.outputTokens != null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [windowControlsMode, setWindowControlsMode] = useState<WindowControlsMode>('none');

  useEffect(
    (signal) => {
      if (!win) {
        setWindowControlsMode('none');
        return;
      }
      const platform = systemBridge?.app?.platform;
      if (!platform) {
        setWindowControlsMode('custom');
        return;
      }
      platform()
        .then((value) => {
          if (!signal.aborted) {
            setWindowControlsMode(value === 'darwin' ? 'native-macos' : 'custom');
          }
        })
        .catch(() => {
          if (!signal.aborted) setWindowControlsMode('custom');
        });
    },
    [win, systemBridge?.app?.platform],
  );

  useEffect(
    (signal) => {
      if (!win || windowControlsMode !== 'custom') {
        setIsMaximized(false);
        return;
      }

      let receivedMaximizedEvent = false;
      const unsubscribe = win.onMaximizedChange?.((value) => {
        receivedMaximizedEvent = true;
        setIsMaximized(value);
      });

      const readIsMaximized = win.isMaximized;
      if (!readIsMaximized) {
        setIsMaximized(false);
        return unsubscribe;
      }
      void readIsMaximized()
        .then((value) => {
          if (!signal.aborted && !receivedMaximizedEvent) setIsMaximized(value);
        })
        .catch(() => {
          if (!signal.aborted && !receivedMaximizedEvent) setIsMaximized(false);
        });

      return unsubscribe;
    },
    [win, windowControlsMode],
  );

  async function handleToggleMaximize(): Promise<void> {
    await win?.toggleMaximize();
    const next = await win?.isMaximized?.();
    if (next === undefined) {
      setIsMaximized((current) => !current);
    } else {
      setIsMaximized(next);
    }
  }

  return (
    <header
      className={cn(
        'flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 [-webkit-app-region:drag]',
        windowControlsMode === 'native-macos' && 'pl-20',
      )}
    >
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
        {win && windowControlsMode === 'custom' && (
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
              aria-label={isMaximized ? 'Restore' : 'Maximize'}
              aria-pressed={isMaximized}
              onClick={() => {
                handleToggleMaximize().catch(noop);
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {isMaximized ? (
                <Minimize2Icon className="size-3.5" />
              ) : (
                <SquareIcon className="size-3" />
              )}
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
