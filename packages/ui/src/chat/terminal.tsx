import Ansi from 'ansi-to-react';
import { TerminalIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { Shimmer } from './shimmer';

export interface TerminalProps extends React.ComponentProps<'div'> {
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
}: TerminalProps): React.ReactNode {
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
        {isStreaming ? <Shimmer className="text-xs">running</Shimmer> : null}
      </TerminalHeader>
      {children ?? (output ? <TerminalContent>{output}</TerminalContent> : null)}
    </div>
  );
}

export type TerminalHeaderProps = React.ComponentProps<'div'>;

export function TerminalHeader({ className, ...props }: TerminalHeaderProps): React.ReactNode {
  return (
    <div
      className={cn('flex items-center justify-between gap-2 px-3 py-2 text-xs', className)}
      {...props}
    />
  );
}

export type TerminalTitleProps = React.ComponentProps<'div'>;

export function TerminalTitle({
  className,
  children,
  ...props
}: TerminalTitleProps): React.ReactNode {
  return (
    <div className={cn('flex min-w-0 items-center gap-2 font-mono', className)} {...props}>
      <TerminalIcon className="size-3.5 shrink-0" />
      <span className="truncate">{children ?? 'Terminal'}</span>
    </div>
  );
}

export type TerminalContentProps = React.ComponentProps<'pre'>;

export function TerminalContent({
  className,
  children,
  ...props
}: TerminalContentProps): React.ReactNode {
  return (
    <pre
      className={cn(
        'max-h-80 overflow-auto border-t border-border px-3 py-2 font-mono text-xs leading-relaxed',
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
