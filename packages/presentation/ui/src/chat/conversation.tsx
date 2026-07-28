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
import { Virtualizer } from 'virtua';
import { cn } from '../lib/cn';

export type ConversationProps = React.ComponentProps<typeof StickToBottom>;

export function Conversation({ className, ...props }: ConversationProps): React.ReactNode {
  return (
    <StickToBottom
      className={cn('relative h-full overflow-hidden', className)}
      // Instant initial positioning: animating from the top would page the whole virtualized
      // history through the viewport.
      initial="instant"
      resize="smooth"
      role="log"
      {...props}
    />
  );
}

export interface ConversationContentProps<T> {
  className?: string;
  /** Timeline rows, virtualized: only rows near the viewport are mounted. */
  data: readonly T[];
  /** Row renderer; must return a keyed element (virtua caches measured sizes per key). */
  // eslint-disable-next-line sukka/react-no-render-function-prop, @typescript-eslint/no-restricted-types -- virtua's windowing contract: only the virtualizer knows which rows are visible, and it requires a keyed ReactElement per row.
  children: (item: T, index: number) => React.ReactElement;
  /** Rendered after the virtualized rows, inside the scrolled column (e.g. the thinking row). */
  trailing?: React.ReactNode;
}

/**
 * The scrolled conversation column. use-stick-to-bottom owns the scroll element and the
 * pinned-to-bottom follow; virtua windows the rows inside it. Rows own their vertical spacing
 * (the container keeps no top padding so virtua's offset math needs no startMargin).
 */
export function ConversationContent<T>({
  className,
  data,
  children,
  trailing,
}: ConversationContentProps<T>): React.ReactNode {
  const { scrollRef } = useStickToBottomContext();
  return (
    <StickToBottom.Content
      className={cn('mx-auto max-w-3xl px-7 pb-6', className)}
      // The browser's own scroll anchoring fights both scroll owners.
      scrollClassName="[overflow-anchor:none]"
    >
      <Virtualizer data={data} scrollRef={scrollRef}>
        {children}
      </Virtualizer>
      {trailing}
    </StickToBottom.Content>
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
