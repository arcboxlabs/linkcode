import { Button } from 'coss-ui/components/button';
import { CheckIcon, CopyIcon } from 'lucide-react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { highlightCode, normalizeCodeLanguage } from './code-highlight';
import type { HighlightedCode, HighlightedToken } from './code-highlight';

export interface CodeBlockProps extends ComponentProps<'div'> {
  code: string;
  language?: string;
  title?: string;
}

export function CodeBlock({
  code,
  language,
  title,
  className,
  children,
  ...props
}: CodeBlockProps): ReactNode {
  const hasHeader = Boolean(title || language || children);

  return (
    <div
      className={cn('my-2 overflow-hidden rounded-lg border border-border bg-muted', className)}
      data-language={language}
      {...props}
    >
      {hasHeader ? (
        <CodeBlockHeader>
          <CodeBlockTitle>{title ?? language}</CodeBlockTitle>
          {children}
        </CodeBlockHeader>
      ) : null}
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed">
        <code>
          <CodeBlockContent code={code} language={language} />
        </code>
      </pre>
    </div>
  );
}

function CodeBlockContent({
  code,
  language,
}: {
  code: string;
  language: string | undefined;
}): ReactNode {
  const normalizedLanguage = normalizeCodeLanguage(language);
  if (!normalizedLanguage || code.length === 0) return code;

  return (
    <Suspense fallback={code}>
      <HighlightedCodeResult code={code} highlighted={highlightCode(code, normalizedLanguage)} />
    </Suspense>
  );
}

function HighlightedCodeResult({
  code,
  highlighted,
}: {
  code: string;
  highlighted: Promise<HighlightedCode | null>;
}): ReactNode {
  const highlightedCode = use(highlighted);
  if (!highlightedCode) return code;
  return <HighlightedCodeContent highlighted={highlightedCode} />;
}

function HighlightedCodeContent({ highlighted }: { highlighted: HighlightedCode }): ReactNode {
  return highlighted.lines.map((line, lineIndex) => (
    <span key={line.key}>
      {line.tokens.map((token) => (
        <HighlightedTokenSpan key={token.key} token={token} />
      ))}
      {lineIndex < highlighted.lines.length - 1 ? '\n' : null}
    </span>
  ));
}

function HighlightedTokenSpan({ token }: { token: HighlightedToken }): ReactNode {
  return (
    <span style={token.color ? ({ color: token.color } satisfies CSSProperties) : undefined}>
      {token.content}
    </span>
  );
}

export type CodeBlockHeaderProps = ComponentProps<'div'>;

export function CodeBlockHeader({ className, ...props }: CodeBlockHeaderProps): ReactNode {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-[12px]',
        className,
      )}
      {...props}
    />
  );
}

export type CodeBlockTitleProps = ComponentProps<'div'>;

export function CodeBlockTitle({ className, ...props }: CodeBlockTitleProps): ReactNode {
  return <div className={cn('truncate font-mono text-muted-foreground', className)} {...props} />;
}

export type CodeBlockActionsProps = ComponentProps<'div'>;

export function CodeBlockActions({ className, ...props }: CodeBlockActionsProps): ReactNode {
  return <div className={cn('-my-1 flex items-center gap-1', className)} {...props} />;
}

export type CodeBlockCopyButtonProps = ComponentProps<typeof Button> & {
  code: string;
  timeout?: number;
};

export function CodeBlockCopyButton({
  code,
  timeout = 1600,
  children,
  className,
  ...props
}: CodeBlockCopyButtonProps): ReactNode {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const handleCopy = useCallback(() => {
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
        timeoutRef.current = window.setTimeout(() => setCopied(false), timeout);
      })
      .catch(() => setCopied(false));
  }, [code, timeout]);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  const Icon = copied ? CheckIcon : CopyIcon;

  return (
    <Button
      aria-label={copied ? 'Copied' : 'Copy'}
      className={cn('size-6', className)}
      onClick={handleCopy}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon />}
    </Button>
  );
}
