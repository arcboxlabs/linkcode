import { CollapsibleContent } from 'coss-ui/components/collapsible';
import { ScrollArea } from 'coss-ui/components/scroll-area';
import { cn } from '../lib/cn';

export const CHAT_DISCLOSURE_MAX_HEIGHT_CLASS_NAME =
  'max-h-96 **:data-[slot=scroll-area-viewport]:max-h-96';

export type ChatDisclosureContentProps = React.ComponentProps<typeof CollapsibleContent> & {
  /** Layout applied inside the scroll viewport so spacing and dividers follow the content. */
  bodyClassName?: string;
  /** Nested disclosures can share the nearest constrained ancestor instead of trapping scroll. */
  constrainHeight?: boolean;
  scrollAreaClassName?: string;
};

/** Shared bounded body for Chat disclosures, with coss-ui's position-aware edge fades. */
export function ChatDisclosureContent({
  bodyClassName,
  children,
  className,
  constrainHeight = true,
  scrollAreaClassName,
  ...props
}: ChatDisclosureContentProps): React.ReactNode {
  const body = <div className={bodyClassName}>{children}</div>;
  const boundedClassName = scrollAreaClassName ?? CHAT_DISCLOSURE_MAX_HEIGHT_CLASS_NAME;

  return (
    <CollapsibleContent className={className} {...props}>
      {constrainHeight ? (
        <ScrollArea
          className={cn('w-full', boundedClassName)}
          data-slot="chat-disclosure-scroll"
          scrollFade
        >
          {body}
        </ScrollArea>
      ) : (
        body
      )}
    </CollapsibleContent>
  );
}
