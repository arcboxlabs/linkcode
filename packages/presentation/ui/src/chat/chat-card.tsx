import { FrameHeader, FramePanel } from 'coss-ui/components/frame';
import { cn } from '../lib/cn';

export type ChatCardHeaderProps = React.ComponentProps<typeof FrameHeader>;

/** coss-ui `FrameHeader` as a single compact row, at chat-flow density. */
export function ChatCardHeader({ className, ...props }: ChatCardHeaderProps): React.ReactNode {
  return (
    <FrameHeader
      className={cn(
        'flex-row items-center gap-2 px-3 py-1.5 text-muted-foreground text-xs',
        className,
      )}
      {...props}
    />
  );
}

export type ChatCardTitleProps = React.ComponentProps<'span'>;

/** Header title label; a span so headers can render as buttons. Sans by design — only
 * terminal/execute headers opt into mono for the command they display. */
export function ChatCardTitle({ className, ...props }: ChatCardTitleProps): React.ReactNode {
  return <span className={cn('min-w-0 truncate text-xs leading-normal', className)} {...props} />;
}

export type ChatCardActionsProps = React.ComponentProps<'span'>;

/** Trailing header slot; a span so it stays valid inside header buttons. */
export function ChatCardActions({ className, ...props }: ChatCardActionsProps): React.ReactNode {
  return <span className={cn('ml-auto flex shrink-0 items-center gap-1', className)} {...props} />;
}

export type ChatCardPanelProps = React.ComponentProps<typeof FramePanel>;

/** coss-ui `FramePanel` body at chat-flow density. */
export function ChatCardPanel({ className, ...props }: ChatCardPanelProps): React.ReactNode {
  return <FramePanel className={cn('px-3 py-2', className)} {...props} />;
}
