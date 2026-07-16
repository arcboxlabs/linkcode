import AnsiImport from 'ansi-to-react';
import { Card, CardHeader, CardTitle } from 'coss-ui/components/card';
import { TerminalIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { Shimmer } from './shimmer';

type AnsiComponent = typeof AnsiImport;

// ansi-to-react is CommonJS with its component stored on `exports.default` while also
// advertising `__esModule`; Vite 8 therefore exposes either the component or that wrapper.
const ansiModule = AnsiImport as AnsiComponent | { default: AnsiComponent };
const Ansi = typeof ansiModule === 'function' ? ansiModule : ansiModule.default;

export interface TerminalProps extends React.ComponentProps<typeof Card> {
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
    <Card
      className={cn('my-1 overflow-hidden bg-muted text-muted-foreground', className)}
      {...props}
    >
      <TerminalHeader>
        <TerminalTitle>{title}</TerminalTitle>
        {isStreaming ? <Shimmer className="text-xs">running</Shimmer> : null}
      </TerminalHeader>
      {children ?? (output ? <TerminalContent>{output}</TerminalContent> : null)}
    </Card>
  );
}

export type TerminalHeaderProps = React.ComponentProps<typeof CardHeader>;

export function TerminalHeader({ className, ...props }: TerminalHeaderProps): React.ReactNode {
  return (
    <CardHeader
      className={cn(
        'grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto] items-center gap-2 px-3 py-1.5 text-xs',
        className,
      )}
      {...props}
    />
  );
}

export type TerminalTitleProps = React.ComponentProps<typeof CardTitle>;

export function TerminalTitle({
  className,
  children,
  ...props
}: TerminalTitleProps): React.ReactNode {
  return (
    <CardTitle
      className={cn(
        'flex min-w-0 items-center gap-2 font-mono font-normal text-xs leading-normal',
        className,
      )}
      {...props}
    >
      <TerminalIcon className="size-3.5 shrink-0" />
      <span className="truncate">{children ?? 'Terminal'}</span>
    </CardTitle>
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
        'max-h-80 overflow-auto border-t border-border px-3 py-2 font-mono text-xs leading-relaxed bg-background',
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
