import { Button } from 'coss-ui/components/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from 'coss-ui/components/empty';
import { ArrowDownIcon } from 'lucide-react';
import { useCallback } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { cn } from '../lib/cn';

export type ConversationProps = React.ComponentProps<typeof StickToBottom>;

export function Conversation({ className, ...props }: ConversationProps): React.ReactNode {
  return (
    <StickToBottom
      className={cn('relative h-full overflow-hidden', className)}
      initial="smooth"
      resize="smooth"
      role="log"
      {...props}
    />
  );
}

export type ConversationContentProps = React.ComponentProps<typeof StickToBottom.Content>;

export function ConversationContent({
  className,
  ...props
}: ConversationContentProps): React.ReactNode {
  return (
    <StickToBottom.Content
      className={cn('mx-auto flex max-w-3xl flex-col gap-6 px-7 py-6', className)}
      {...props}
    />
  );
}

export type ConversationEmptyStateProps = React.ComponentProps<'div'> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
};

export function ConversationEmptyState({
  className,
  title,
  description,
  icon,
  children,
  ...props
}: ConversationEmptyStateProps): React.ReactNode {
  return (
    <Empty className={cn('h-full', className)} {...props}>
      {children ?? (
        <EmptyHeader>
          {icon ? <EmptyMedia variant="icon">{icon}</EmptyMedia> : null}
          {title ? <EmptyTitle>{title}</EmptyTitle> : null}
          {description ? <EmptyDescription>{description}</EmptyDescription> : null}
        </EmptyHeader>
      )}
    </Empty>
  );
}

export type ConversationScrollButtonProps = React.ComponentProps<typeof Button>;

export function ConversationScrollButton({
  className,
  ...props
}: ConversationScrollButtonProps): React.ReactNode {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const handleScroll = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  if (isAtBottom) return null;

  return (
    <Button
      aria-label="Scroll to bottom"
      className={cn('absolute right-4 bottom-4 rounded-full shadow-sm', className)}
      onClick={handleScroll}
      size="icon-sm"
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDownIcon />
    </Button>
  );
}
