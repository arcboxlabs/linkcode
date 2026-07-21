import { Card } from 'coss-ui/components/card';
import { Collapsible, CollapsibleTrigger } from 'coss-ui/components/collapsible';
import { InputGroup, InputGroupAddon, InputGroupInput } from 'coss-ui/components/input-group';
import { ExternalLinkIcon, GlobeIcon, RotateCwIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/cn';
import { ChatDisclosureContent } from './disclosure-content';
import {
  CHAT_DISCLOSURE_TEXT_CLASS_NAME,
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
  ChatDisclosureChevron,
} from './disclosure-header';
import type { TooltipIconButtonProps } from './tooltip-icon-button';
import { TooltipIconButton } from './tooltip-icon-button';

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

export type WebPreviewProps = React.ComponentProps<'div'> & {
  preview: ChatWebPreviewData;
  onAddressCommit?: (url: string) => void;
};

export function WebPreview({
  className,
  preview,
  onAddressCommit,
  children,
  ...props
}: WebPreviewProps): React.ReactNode {
  return (
    <Card className={cn('my-2 min-h-96 overflow-hidden shadow-sm', className)} {...props}>
      {children ?? (
        <WebPreviewSession
          key={`${preview.id}:${preview.url}`}
          onAddressCommit={onAddressCommit}
          preview={preview}
        />
      )}
    </Card>
  );
}

function WebPreviewSession({
  preview,
  onAddressCommit,
}: Pick<WebPreviewProps, 'preview' | 'onAddressCommit'>): React.ReactNode {
  const [currentAddress, setCurrentAddress] = useState(preview.url);
  const [reloadToken, setReloadToken] = useState(0);

  function commitAddress(nextAddress: string): void {
    setCurrentAddress(nextAddress);
    onAddressCommit?.(nextAddress);
  }

  return (
    <>
      <WebPreviewNavigation>
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
      <WebPreviewBody key={reloadToken} src={currentAddress} title={preview.title ?? 'Preview'} />
      <WebPreviewConsole logs={preview.logs ?? []} />
    </>
  );
}

export type WebPreviewNavigationProps = React.ComponentProps<'div'>;

export function WebPreviewNavigation({
  className,
  ...props
}: WebPreviewNavigationProps): React.ReactNode {
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

export type WebPreviewNavigationButtonProps = TooltipIconButtonProps;

export function WebPreviewNavigationButton(
  props: WebPreviewNavigationButtonProps,
): React.ReactNode {
  return <TooltipIconButton {...props} />;
}

export type WebPreviewUrlProps = Omit<React.ComponentProps<'input'>, 'onKeyDown'> & {
  onCommit?: (url: string) => void;
};

/** Omnibox-style address bar: a rounded pill with a leading globe, mirroring coss-ui input tokens. */
export function WebPreviewUrl({
  className,
  onCommit,
  ...props
}: WebPreviewUrlProps): React.ReactNode {
  return (
    <InputGroup className="h-7 flex-1 rounded-full before:rounded-full">
      <InputGroupAddon>
        <GlobeIcon className="size-3.5 text-muted-foreground" />
      </InputGroupAddon>
      <InputGroupInput
        className={cn('font-mono text-[12px] placeholder:text-muted-foreground/72', className)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit?.(event.currentTarget.value);
        }}
        spellCheck={false}
        {...props}
      />
    </InputGroup>
  );
}

export type WebPreviewBodyProps = React.ComponentProps<'iframe'>;

export function WebPreviewBody({
  className,
  title = 'Preview',
  ref,
  ...props
}: WebPreviewBodyProps): React.ReactNode {
  return (
    <iframe
      className={cn('min-h-0 flex-1 border-0 bg-white', className)}
      ref={ref}
      sandbox="allow-scripts allow-forms allow-popups allow-presentation"
      title={title}
      {...props}
    />
  );
}

export type WebPreviewConsoleProps = React.ComponentProps<typeof Collapsible> & {
  logs?: readonly ChatWebPreviewLog[];
};

export function WebPreviewConsole({
  className,
  logs = EMPTY_WEB_PREVIEW_LOGS,
  children,
  defaultOpen = false,
  ...props
}: WebPreviewConsoleProps): React.ReactNode {
  return (
    <Collapsible
      className={cn('border-t border-border bg-muted/30 text-[12px]', className)}
      defaultOpen={defaultOpen}
      {...props}
    >
      {children ?? (
        <>
          <CollapsibleTrigger
            className={cn(CHAT_DISCLOSURE_TRIGGER_CLASS_NAME, 'w-full px-3 py-2')}
          >
            <span className={CHAT_DISCLOSURE_TEXT_CLASS_NAME}>
              <span className={CHAT_DISCLOSURE_TITLE_CLASS_NAME}>Console</span>
            </span>
            {logs.length > 0 ? (
              <span className="shrink-0 text-muted-foreground">{logs.length}</span>
            ) : null}
            <ChatDisclosureChevron />
          </CollapsibleTrigger>
          <ChatDisclosureContent
            className="border-t border-border p-3 font-mono"
            scrollAreaClassName="max-h-40 **:data-[slot=scroll-area-viewport]:max-h-40"
          >
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
          </ChatDisclosureContent>
        </>
      )}
    </Collapsible>
  );
}
