import { ArrowLeftIcon, ArrowRightIcon, GlobeIcon, RotateCwIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { WebPreviewNavigationButton, WebPreviewUrl } from '../../chat/web-preview';
import { cn } from '../../lib/cn';
import { isAllowedBrowserUrl, normalizeBrowserUrl } from './normalize';

export interface BrowserPaneProps {
  /** Current address; null renders the empty state. */
  url: string | null;
  isLoading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** Human-readable load failure for the current page, if any. */
  failure?: string | null;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  /** The host's actual browsing surface (desktop: the Electron webview). */
  children?: React.ReactNode;
  className?: string;
}

/** The right panel's Browser section chrome: nav strip over the host's webview. */
export function BrowserPane({
  url,
  isLoading,
  canGoBack,
  canGoForward,
  failure,
  onNavigate,
  onBack,
  onForward,
  onReload,
  children,
  className,
}: BrowserPaneProps): React.ReactNode {
  const t = useTranslations('workbench.preview.browser');

  function commit(value: string): void {
    const next = normalizeBrowserUrl(value);
    if (next.length > 0 && isAllowedBrowserUrl(next)) onNavigate(next);
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)}>
      <div className="flex shrink-0 items-center gap-1.5 border-border border-b bg-muted/40 px-3 py-2">
        <WebPreviewNavigationButton
          disabled={canGoBack !== true}
          tooltip={t('back')}
          onClick={onBack}
        >
          <ArrowLeftIcon />
        </WebPreviewNavigationButton>
        <WebPreviewNavigationButton
          disabled={canGoForward !== true}
          tooltip={t('forward')}
          onClick={onForward}
        >
          <ArrowRightIcon />
        </WebPreviewNavigationButton>
        <WebPreviewNavigationButton
          disabled={url === null}
          tooltip={t('reload')}
          onClick={onReload}
        >
          <RotateCwIcon className={cn(isLoading && 'animate-spin')} />
        </WebPreviewNavigationButton>
        <WebPreviewUrl
          key={url ?? ''}
          defaultValue={url ?? ''}
          placeholder={t('placeholder')}
          onCommit={commit}
        />
      </div>
      <div className="relative min-h-0 flex-1 bg-background">
        {children}
        {url === null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
            <GlobeIcon className="size-6" />
            <p className="text-sm">{t('empty')}</p>
          </div>
        )}
        {failure !== null && failure !== undefined && url !== null && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <div className="max-w-[80%] truncate rounded-md border border-border bg-background/95 px-3 py-1.5 text-destructive-foreground text-xs shadow-sm">
              {failure}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
