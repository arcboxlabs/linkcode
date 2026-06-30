import { Button } from 'coss-ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GlobeIcon,
  RotateCwIcon,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useRef, useState } from 'react';
import { cn } from '../lib/cn';

const EMPTY_WEB_PREVIEW_LOGS: readonly ChatWebPreviewLog[] = [];

// TODO(linkcode-schema): Provisional UI-only web preview data, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when preview sessions/logs are emitted by the data plane.
export interface ChatWebPreviewData {
  id: string;
  url: string;
  title?: string;
  logs?: ChatWebPreviewLog[];
}

export interface ChatWebPreviewLog {
  id: string;
  level: 'log' | 'warn' | 'error';
  message: string;
  timestamp?: string;
}

export type WebPreviewProps = ComponentProps<'div'> & {
  preview: ChatWebPreviewData;
  onAddressCommit?: (url: string) => void;
};

export function WebPreview({
  className,
  preview,
  onAddressCommit,
  children,
  ...props
}: WebPreviewProps): ReactNode {
  const [currentAddress, setCurrentAddress] = useState(preview.url);
  const [reloadToken, setReloadToken] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  function commitAddress(nextAddress: string): void {
    setCurrentAddress(nextAddress);
    onAddressCommit?.(nextAddress);
  }

  function navigateHistory(direction: 'back' | 'forward'): void {
    try {
      iframeRef.current?.contentWindow?.history[direction]();
    } catch {
      // Cross-origin frames forbid history access; the buttons simply no-op there.
    }
  }

  return (
    <div
      className={cn(
        'my-2 flex min-h-96 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <WebPreviewNavigation>
            <WebPreviewNavigationButton onClick={() => navigateHistory('back')} tooltip="Back">
              <ArrowLeftIcon />
            </WebPreviewNavigationButton>
            <WebPreviewNavigationButton
              onClick={() => navigateHistory('forward')}
              tooltip="Forward"
            >
              <ArrowRightIcon />
            </WebPreviewNavigationButton>
            <WebPreviewNavigationButton
              onClick={() => setReloadToken((token) => token + 1)}
              tooltip="Reload"
            >
              <RotateCwIcon />
            </WebPreviewNavigationButton>
            <WebPreviewUrl defaultValue={currentAddress} onCommit={commitAddress} />
            <WebPreviewNavigationButton
              render={<a href={currentAddress} rel="noreferrer" target="_blank" />}
              tooltip="Open in new tab"
            >
              <ExternalLinkIcon />
            </WebPreviewNavigationButton>
          </WebPreviewNavigation>
          <WebPreviewBody
            key={reloadToken}
            ref={iframeRef}
            src={currentAddress}
            title={preview.title ?? 'Preview'}
          />
          <WebPreviewConsole logs={preview.logs ?? []} />
        </>
      )}
    </div>
  );
}

export type WebPreviewNavigationProps = ComponentProps<'div'>;

export function WebPreviewNavigation({
  className,
  ...props
}: WebPreviewNavigationProps): ReactNode {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-2',
        className,
      )}
      {...props}
    />
  );
}

export type WebPreviewNavigationButtonProps = ComponentProps<typeof Button> & {
  tooltip?: string;
};

export function WebPreviewNavigationButton({
  tooltip,
  children,
  size = 'icon-xs',
  variant = 'ghost',
  ...props
}: WebPreviewNavigationButtonProps): ReactNode {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
    </Button>
  );

  if (!tooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export type WebPreviewUrlProps = Omit<ComponentProps<'input'>, 'onKeyDown'> & {
  onCommit?: (url: string) => void;
};

/** Omnibox-style address bar: a rounded pill with a leading globe, mirroring coss-ui input tokens. */
export function WebPreviewUrl({ className, onCommit, ...props }: WebPreviewUrlProps): ReactNode {
  return (
    <span className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-full border border-input bg-background px-3 shadow-xs/5 transition-shadow focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/24 dark:bg-input/32">
      <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        className={cn(
          'min-w-0 flex-1 bg-transparent font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/72',
          className,
        )}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit?.(event.currentTarget.value);
        }}
        spellCheck={false}
        {...props}
      />
    </span>
  );
}

export type WebPreviewBodyProps = ComponentProps<'iframe'>;

export function WebPreviewBody({
  className,
  title = 'Preview',
  ref,
  ...props
}: WebPreviewBodyProps): ReactNode {
  return (
    <iframe
      className={cn('min-h-0 flex-1 border-0 bg-white', className)}
      ref={ref}
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-presentation"
      title={title}
      {...props}
    />
  );
}

export type WebPreviewConsoleProps = ComponentProps<typeof Collapsible> & {
  logs?: readonly ChatWebPreviewLog[];
};

export function WebPreviewConsole({
  className,
  logs = EMPTY_WEB_PREVIEW_LOGS,
  children,
  defaultOpen = false,
  ...props
}: WebPreviewConsoleProps): ReactNode {
  return (
    <Collapsible
      className={cn('border-t border-border bg-muted/30 text-[12px]', className)}
      defaultOpen={defaultOpen}
      {...props}
    >
      {children ?? (
        <>
          <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left font-medium">
            <ChevronRightIcon className="size-3.5 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
            Console
            {logs.length > 0 ? <span className="text-muted-foreground">{logs.length}</span> : null}
          </CollapsibleTrigger>
          <CollapsibleContent className="max-h-40 overflow-auto border-t border-border p-3 font-mono">
            {logs.length === 0 ? (
              <div className="text-muted-foreground">No console output</div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className={cn(
                    log.level === 'error' && 'text-destructive-foreground',
                    log.level === 'warn' && 'text-warning-foreground',
                  )}
                >
                  {log.timestamp ? (
                    <span className="text-muted-foreground">{log.timestamp} </span>
                  ) : null}
                  {log.message}
                </div>
              ))
            )}
          </CollapsibleContent>
        </>
      )}
    </Collapsible>
  );
}
