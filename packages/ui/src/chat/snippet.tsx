import { Button } from 'coss-ui/components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from 'coss-ui/components/input-group';
import { CheckIcon, CopyIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

// TODO(linkcode-schema): Provisional UI-only snippet model, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when tool outputs expose reusable command/code snippets.
export interface ChatSnippet {
  id: string;
  code: string;
  label?: string;
  language?: string;
}

export type SnippetProps = ComponentProps<typeof InputGroup> & {
  snippet: ChatSnippet;
};

export function Snippet({ className, snippet, children, ...props }: SnippetProps): ReactNode {
  return (
    <InputGroup className={cn('my-2 font-mono', className)} {...props}>
      {children ?? (
        <>
          {snippet.label ? (
            <InputGroupAddon>
              <span className="text-muted-foreground">{snippet.label}</span>
            </InputGroupAddon>
          ) : null}
          <SnippetInput code={snippet.code} />
          <InputGroupAddon align="inline-end">
            <SnippetCopyButton code={snippet.code} />
          </InputGroupAddon>
        </>
      )}
    </InputGroup>
  );
}

export type SnippetInputProps = Omit<
  ComponentProps<typeof InputGroupInput>,
  'readOnly' | 'value'
> & {
  code: string;
};

export function SnippetInput({ className, code, ...props }: SnippetInputProps): ReactNode {
  return (
    <InputGroupInput
      className={cn('text-foreground', className)}
      readOnly
      value={code}
      {...props}
    />
  );
}

export type SnippetCopyButtonProps = ComponentProps<typeof Button> & {
  code: string;
  timeout?: number;
};

export function SnippetCopyButton({
  className,
  code,
  timeout = 1600,
  children,
  ...props
}: SnippetCopyButtonProps): ReactNode {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const Icon = copied ? CheckIcon : CopyIcon;

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  return (
    <Button
      aria-label={copied ? 'Copied' : 'Copy'}
      className={cn('size-6', className)}
      onClick={() => {
        void navigator.clipboard
          .writeText(code)
          .then(() => {
            setCopied(true);
            if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
            timeoutRef.current = window.setTimeout(() => setCopied(false), timeout);
          })
          .catch(() => setCopied(false));
      }}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon className="size-3.5" />}
    </Button>
  );
}
