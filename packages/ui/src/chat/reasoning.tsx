import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { BrainIcon, ChevronRightIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { Shimmer } from './shimmer';

interface ReasoningContextValue {
  isOpen: boolean;
  isStreaming: boolean;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

function useReasoning(): ReasoningContextValue {
  const context = useContext(ReasoningContext);
  if (!context) throw new Error('Reasoning components must be used within Reasoning');
  return context;
}

export type ReasoningProps = Omit<
  ComponentProps<typeof Collapsible>,
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
}: ReasoningProps): ReactNode {
  const [isOpenState, setIsOpenState] = useState(defaultOpen ?? isStreaming);
  const hasStreamedRef = useRef(isStreaming);
  const isOpen = isStreaming || isOpenState;

  useEffect(() => {
    if (isStreaming) {
      hasStreamedRef.current = true;
      const timer = window.setTimeout(() => setIsOpenState(true), 0);
      return () => window.clearTimeout(timer);
    }
    if (!hasStreamedRef.current) return;
    const timer = window.setTimeout(() => setIsOpenState(false), 1000);
    return () => window.clearTimeout(timer);
  }, [isStreaming]);

  const contextValue = useMemo(() => ({ isOpen, isStreaming }), [isOpen, isStreaming]);

  return (
    <ReasoningContext.Provider value={contextValue}>
      <Collapsible
        className={cn('text-muted-foreground', className)}
        onOpenChange={setIsOpenState}
        open={isOpen}
        {...props}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
}

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  label: string;
  preview?: string;
};

export function ReasoningTrigger({
  className,
  label,
  preview,
  children,
  ...props
}: ReasoningTriggerProps): ReactNode {
  const { isOpen, isStreaming } = useReasoning();

  return (
    <CollapsibleTrigger
      className={cn(
        'flex w-full items-center gap-2 py-0.5 text-left text-[13px] hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <BrainIcon className="size-3.5 shrink-0" />
          <span className="font-medium">{isStreaming ? <Shimmer>{label}</Shimmer> : label}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
            {isOpen ? '' : preview}
          </span>
          <ChevronRightIcon
            className={cn('size-3.5 shrink-0 transition-transform', isOpen && 'rotate-90')}
          />
        </>
      )}
    </CollapsibleTrigger>
  );
}

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent>;

export function ReasoningContent({ className, ...props }: ReasoningContentProps): ReactNode {
  return (
    <CollapsibleContent
      className={cn('mt-1 border-l-2 border-border pl-3 text-[13px] italic opacity-90', className)}
      {...props}
    />
  );
}
