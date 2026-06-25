import { Button } from 'coss-ui/components/button';
import { ScrollArea } from 'coss-ui/components/scroll-area';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

// TODO(linkcode-schema): Provisional UI-only suggested action, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when daemon/client suggestions are part of the data plane.
export interface ChatSuggestion {
  id: string;
  label: string;
  prompt?: string;
  description?: string;
  disabled?: boolean;
}

export type SuggestionsProps = ComponentProps<typeof ScrollArea> & {
  suggestions?: readonly ChatSuggestion[];
  onSuggestionSelect?: (suggestion: ChatSuggestion) => void;
};

export function Suggestions({
  className,
  suggestions,
  onSuggestionSelect,
  children,
  ...props
}: SuggestionsProps): ReactNode {
  return (
    <ScrollArea className={cn('w-full max-w-full', className)} {...props}>
      <div className="flex w-max max-w-full flex-nowrap items-center gap-2 py-1">
        {children ??
          suggestions?.map((suggestion) => (
            <Suggestion
              key={suggestion.id}
              suggestion={suggestion}
              onSuggestionSelect={onSuggestionSelect}
            />
          ))}
      </div>
    </ScrollArea>
  );
}

export type SuggestionProps = Omit<ComponentProps<typeof Button>, 'onClick'> & {
  suggestion: ChatSuggestion;
  onSuggestionSelect?: (suggestion: ChatSuggestion) => void;
};

export function Suggestion({
  suggestion,
  onSuggestionSelect,
  className,
  children,
  disabled = suggestion.disabled,
  size = 'sm',
  variant = 'outline',
  ...props
}: SuggestionProps): ReactNode {
  return (
    <Button
      className={cn('max-w-72 rounded-full px-3', className)}
      disabled={disabled}
      onClick={() => onSuggestionSelect?.(suggestion)}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      <span className="truncate">{children ?? suggestion.label}</span>
    </Button>
  );
}
