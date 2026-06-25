import Ansi from 'ansi-to-react';
import { TerminalIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Shimmer } from './shimmer';

export interface TerminalProps extends ComponentProps<'div'> {
  title?: string;
  output?: string;
  isStreaming?: boolean;
}

export function Terminal({
  title,
  output,
  isStreaming = false,
  className,
  children,
  ...props
}: TerminalProps): ReactNode {
  return (
    <div
      className={cn(
        'my-1 overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground',
        className,
      )}
      {...props}
    >
      <TerminalHeader>
        <TerminalTitle>{title}</TerminalTitle>
        {isStreaming ? <Shimmer className="text-[11px]">running</Shimmer> : null}
      </TerminalHeader>
      {children ?? (output ? <TerminalContent>{output}</TerminalContent> : null)}
    </div>
  );
}

export type TerminalHeaderProps = ComponentProps<'div'>;

export function TerminalHeader({ className, ...props }: TerminalHeaderProps): ReactNode {
  return (
    <div
      className={cn('flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]', className)}
      {...props}
    />
  );
}

export type TerminalTitleProps = ComponentProps<'div'>;

export function TerminalTitle({ className, children, ...props }: TerminalTitleProps): ReactNode {
  return (
    <div className={cn('flex min-w-0 items-center gap-2 font-mono', className)} {...props}>
      <TerminalIcon className="size-3.5 shrink-0" />
      <span className="truncate">{children ?? 'Terminal'}</span>
    </div>
  );
}

export type TerminalContentProps = ComponentProps<'pre'>;

export function TerminalContent({
  className,
  children,
  ...props
}: TerminalContentProps): ReactNode {
  return (
    <pre
      className={cn(
        'max-h-80 overflow-auto border-t border-border px-3 py-2 font-mono text-[12px] leading-relaxed',
        className,
      )}
      {...props}
    >
      {typeof children === 'string' ? (
        <Ansi useClasses linkify={false}>
          {children}
        </Ansi>
      ) : (
        children
      )}
    </pre>
  );
}
