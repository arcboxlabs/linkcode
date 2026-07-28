import { Button } from 'coss-ui/components/button';
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from 'coss-ui/components/menu';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  EllipsisVerticalIcon,
  GlobeIcon,
  RotateCwIcon,
  SearchIcon,
  XIcon,
} from 'lucide-react';
import { useTranslations } from 'use-intl';
import { WebPreviewNavigationButton, WebPreviewUrl } from '../../chat/web-preview';
import { cn } from '../../lib/cn';
import { isAllowedBrowserUrl, normalizeBrowserUrl } from './normalize';

export interface BrowserFindState {
  query: string;
  /** 1-based active ordinal / total matches; null before the first result arrives. */
  matches: { active: number; total: number } | null;
}

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
  /** Presence renders the find-in-page bar (the host owns open/close state). */
  find?: BrowserFindState | null;
  onFindQueryChange?: (query: string) => void;
  onFindStep?: (forward: boolean) => void;
  onFindClose?: () => void;
  /** Presence renders the overflow page menu (find / zoom / devtools). */
  onOpenFind?: () => void;
  onZoom?: (action: 'in' | 'out' | 'reset') => void;
  onOpenDevTools?: () => void;
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
  find,
  onFindQueryChange,
  onFindStep,
  onFindClose,
  onOpenFind,
  onZoom,
  onOpenDevTools,
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
        {onZoom !== undefined && (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label={t('pageMenu')}
                  className="shrink-0"
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <EllipsisVerticalIcon className="size-3.5" />
                </Button>
              }
            />
            <MenuPopup align="end">
              <MenuItem disabled={url === null} onClick={onOpenFind}>
                {t('findAction')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem disabled={url === null} onClick={() => onZoom('in')}>
                {t('zoomIn')}
              </MenuItem>
              <MenuItem disabled={url === null} onClick={() => onZoom('out')}>
                {t('zoomOut')}
              </MenuItem>
              <MenuItem disabled={url === null} onClick={() => onZoom('reset')}>
                {t('resetZoom')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem disabled={url === null} onClick={onOpenDevTools}>
                {t('openDevTools')}
              </MenuItem>
            </MenuPopup>
          </Menu>
        )}
      </div>
      {find != null && (
        <div className="flex shrink-0 items-center gap-1.5 border-border border-b bg-muted/40 px-3 py-1.5">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground/72"
            placeholder={t('findPlaceholder')}
            spellCheck={false}
            value={find.query}
            onChange={(event) => onFindQueryChange?.(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onFindStep?.(!event.shiftKey);
              else if (event.key === 'Escape') onFindClose?.();
            }}
          />
          {find.matches !== null && (
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {t('findMatches', { active: find.matches.active, total: find.matches.total })}
            </span>
          )}
          <WebPreviewNavigationButton
            disabled={find.matches === null || find.matches.total === 0}
            tooltip={t('findPrevious')}
            onClick={() => onFindStep?.(false)}
          >
            <ChevronUpIcon />
          </WebPreviewNavigationButton>
          <WebPreviewNavigationButton
            disabled={find.matches === null || find.matches.total === 0}
            tooltip={t('findNext')}
            onClick={() => onFindStep?.(true)}
          >
            <ChevronDownIcon />
          </WebPreviewNavigationButton>
          <WebPreviewNavigationButton tooltip={t('findClose')} onClick={() => onFindClose?.()}>
            <XIcon />
          </WebPreviewNavigationButton>
        </div>
      )}
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
