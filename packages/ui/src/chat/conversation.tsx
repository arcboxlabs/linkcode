import { Button } from 'coss-ui/components/button';
import { ArrowDownIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useCallback } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { cn } from '../lib/cn';

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export function Conversation({ className, ...props }: ConversationProps): ReactNode {
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

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>;

export function ConversationContent({ className, ...props }: ConversationContentProps): ReactNode {
  return (
    <StickToBottom.Content
      className={cn('mx-auto flex max-w-3xl flex-col gap-6 px-7 py-6', className)}
      {...props}
    />
  );
}

export type ConversationEmptyStateProps = ComponentProps<'div'> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
};

export function ConversationEmptyState({
  className,
  title,
  description,
  icon,
  children,
  ...props
}: ConversationEmptyStateProps): ReactNode {
  return (
    <div
      className={cn('flex h-full items-center justify-center p-8 text-center', className)}
      {...props}
    >
      {children ?? (
        <div className="max-w-sm">
          {icon ? (
            <div className="mb-3 flex justify-center text-muted-foreground">{icon}</div>
          ) : null}
          {title ? <h2 className="font-medium text-foreground">{title}</h2> : null}
          {description ? <p className="mt-1 text-muted-foreground text-sm">{description}</p> : null}
        </div>
      )}
    </div>
  );
}

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export function ConversationScrollButton({
  className,
  ...props
}: ConversationScrollButtonProps): ReactNode {
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
