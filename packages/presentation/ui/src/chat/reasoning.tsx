import { Collapsible, CollapsibleTrigger } from 'coss-ui/components/collapsible';
import { nullthrow } from 'foxts/guard';
import { SparklesIcon } from 'lucide-react';
import { createContext, useContext, useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import type { ChatDisclosureContentProps } from './disclosure-content';
import { ChatDisclosureContent } from './disclosure-content';
import {
  CHAT_DISCLOSURE_SUMMARY_CLASS_NAME,
  CHAT_DISCLOSURE_TEXT_CLASS_NAME,
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
  ChatDisclosureChevron,
  ChatDisclosureIconSlot,
} from './disclosure-header';
import { Shimmer } from './shimmer';

interface ReasoningContextValue {
  isOpen: boolean;
  isStreaming: boolean;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

function useReasoning(): ReasoningContextValue {
  return nullthrow(
    useContext(ReasoningContext),
    'Reasoning components must be used within Reasoning',
  );
}

export type ReasoningProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  'defaultOpen' | 'onOpenChange' | 'open'
> & {
  isStreaming?: boolean;
  defaultOpen?: boolean;
};

export function Reasoning({
  className,
  isStreaming = false,
  defaultOpen,
  children,
  ...props
}: ReasoningProps): React.ReactNode {
  const [manualOpen, setManualOpen] = useState(defaultOpen ?? false);
  const isOpen = isStreaming || manualOpen;

  const contextValue = useMemo(() => ({ isOpen, isStreaming }), [isOpen, isStreaming]);

  return (
    <ReasoningContext.Provider value={contextValue}>
      <Collapsible
        className={cn('text-muted-foreground', className)}
        onOpenChange={setManualOpen}
        open={isOpen}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
}

export type ReasoningTriggerProps = React.ComponentProps<typeof CollapsibleTrigger> & {
  label: string;
  summary?: string;
};

export function ReasoningTrigger({
  className,
  label,
  summary,
  children,
  ...props
}: ReasoningTriggerProps): React.ReactNode {
  const { isOpen, isStreaming } = useReasoning();

  return (
    <CollapsibleTrigger
      className={cn(CHAT_DISCLOSURE_TRIGGER_CLASS_NAME, 'w-full', className)}
      {...props}
    >
      {children ?? (
        <>
          <ChatDisclosureIconSlot>
            <SparklesIcon />
          </ChatDisclosureIconSlot>
          <span className={CHAT_DISCLOSURE_TEXT_CLASS_NAME}>
            <span className={CHAT_DISCLOSURE_TITLE_CLASS_NAME}>
              {isStreaming ? <Shimmer>{label}</Shimmer> : label}
            </span>
            {summary ? <span className={CHAT_DISCLOSURE_SUMMARY_CLASS_NAME}>{summary}</span> : null}
          </span>
          <ChatDisclosureChevron open={isOpen} />
        </>
      )}
    </CollapsibleTrigger>
  );
}

export type ReasoningContentProps = ChatDisclosureContentProps;

export function ReasoningContent({ className, ...props }: ReasoningContentProps): React.ReactNode {
  return (
    <ChatDisclosureContent
      className={cn('mt-1 border-l-2 border-border pl-3 text-sm italic opacity-90', className)}
      {...props}
    />
  );
}
