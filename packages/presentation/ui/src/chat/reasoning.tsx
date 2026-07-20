import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { nullthrow } from 'foxts/guard';
import { BrainIcon, ChevronRightIcon } from 'lucide-react';
import { createContext, useContext, useMemo, useState } from 'react';
import { cn } from '../lib/cn';
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
  preview?: string;
};

export function ReasoningTrigger({
  className,
  label,
  preview,
  children,
  ...props
}: ReasoningTriggerProps): React.ReactNode {
  const { isOpen, isStreaming } = useReasoning();

  return (
    <CollapsibleTrigger
      className={cn(
        'flex w-full items-center gap-2 py-1 text-left text-sm hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <ChevronRightIcon
            className={cn('size-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')}
          />
          <BrainIcon className="size-3.5 shrink-0" />
          <span className="font-medium">{isStreaming ? <Shimmer>{label}</Shimmer> : label}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
            {isOpen ? '' : preview}
          </span>
        </>
      )}
    </CollapsibleTrigger>
  );
}

export type ReasoningContentProps = React.ComponentProps<typeof CollapsibleContent>;

export function ReasoningContent({ className, ...props }: ReasoningContentProps): React.ReactNode {
  return (
    <CollapsibleContent
      className={cn('mt-1 border-l-2 border-border pl-3 text-sm italic opacity-90', className)}
      {...props}
    />
  );
}
