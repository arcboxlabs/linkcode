import { Button } from 'coss-ui/components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from 'coss-ui/components/input-group';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { useCopyButton } from './use-copy-button';

// TODO(linkcode-schema): Provisional UI-only snippet model, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when tool outputs expose reusable command/code snippets.
export interface ChatSnippet {
  id: string;
  code: string;
  label?: string;
  language?: string;
}

export type SnippetProps = React.ComponentProps<typeof InputGroup> & {
  snippet: ChatSnippet;
};

export function Snippet({ className, snippet, children, ...props }: SnippetProps): React.ReactNode {
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
  React.ComponentProps<typeof InputGroupInput>,
  'readOnly' | 'value'
> & {
  code: string;
};

export function SnippetInput({ className, code, ...props }: SnippetInputProps): React.ReactNode {
  return (
    <InputGroupInput
      className={cn('text-foreground', className)}
      readOnly
      value={code}
      {...props}
    />
  );
}

export type SnippetCopyButtonProps = React.ComponentProps<typeof Button> & {
  code: string;
  timeout?: number;
};

export function SnippetCopyButton({
  code,
  timeout = 1600,
  children,
  ...props
}: SnippetCopyButtonProps): React.ReactNode {
  const { copied, copyValue } = useCopyButton(code, timeout);

  return (
    <Button
      aria-label={copied ? 'Copied' : 'Copy'}
      onClick={copyValue}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? (copied ? <CheckIcon /> : <CopyIcon />)}
    </Button>
  );
}
