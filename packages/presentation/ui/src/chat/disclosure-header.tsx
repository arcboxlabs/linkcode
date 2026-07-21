import { ChevronRightIcon } from 'lucide-react';
import { cn } from '../lib/cn';

export const CHAT_DISCLOSURE_TRIGGER_CLASS_NAME =
  'group flex min-w-0 cursor-pointer items-center gap-2 py-1 text-left text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-disabled:pointer-events-none aria-disabled:cursor-default aria-disabled:opacity-64';

export const CHAT_DISCLOSURE_TEXT_CLASS_NAME =
  'flex min-w-0 shrink items-baseline gap-2 overflow-hidden';

export const CHAT_DISCLOSURE_TITLE_CLASS_NAME =
  'max-w-full shrink-0 truncate font-medium opacity-80';

export const CHAT_DISCLOSURE_SUMMARY_CLASS_NAME =
  'min-w-0 shrink truncate text-muted-foreground/70';

export type ChatDisclosureIconSlotProps = React.ComponentProps<'span'>;

export function ChatDisclosureIconSlot({
  className,
  ...props
}: ChatDisclosureIconSlotProps): React.ReactNode {
  return (
    <span
      className={cn(
        'flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5 [&_svg]:shrink-0',
        className,
      )}
      data-slot="chat-disclosure-icon"
      {...props}
    />
  );
}

export type ChatDisclosureChevronProps = React.ComponentProps<typeof ChevronRightIcon> & {
  open?: boolean;
};

export function ChatDisclosureChevron({
  className,
  open,
  ...props
}: ChatDisclosureChevronProps): React.ReactNode {
  return (
    <ChevronRightIcon
      aria-hidden="true"
      className={cn(
        'size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90',
        open && 'rotate-90',
        className,
      )}
      data-slot="chat-disclosure-chevron"
      {...props}
    />
  );
}
