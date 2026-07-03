import { Button } from 'coss-ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { AlertTriangleIcon, CheckIcon, ChevronRightIcon, CopyIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { keyedItems } from './content-keys';
import { useCopyButton } from './use-copy-button';

// TODO(linkcode-schema): Provisional UI-only stack trace model, not yet wired to daemon/client schema.
// Move or replace with @linkcode/schema types when test/tool outputs expose structured stack traces.
export interface ChatStackTrace {
  id: string;
  trace: string;
  title?: string;
  language?: string;
}

interface ParsedStackFrame {
  raw: string;
  functionName?: string;
  filePath?: string;
  lineNumber?: number;
  columnNumber?: number;
  isInternal: boolean;
}

interface ParsedStackTrace {
  errorType?: string;
  errorMessage: string;
  frames: ParsedStackFrame[];
}

interface ParsedStackLocation {
  filePath: string;
  lineNumber: number;
  columnNumber: number;
}

export type StackTraceProps = React.ComponentProps<typeof Collapsible> & {
  stackTrace: ChatStackTrace;
  onFilePathClick?: (filePath: string, line?: number, column?: number) => void;
};

export function StackTrace({
  className,
  stackTrace,
  defaultOpen = false,
  onFilePathClick,
  children,
  ...props
}: StackTraceProps): React.ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const parsed = useMemo(() => parseStackTrace(stackTrace.trace), [stackTrace.trace]);

  return (
    <Collapsible
      className={cn(
        'my-2 overflow-hidden rounded-lg border border-border bg-card font-mono text-xs',
        className,
      )}
      open={open}
      onOpenChange={setOpen}
      {...props}
    >
      {children ?? (
        <>
          <StackTraceHeader open={open} parsed={parsed} stackTrace={stackTrace} />
          <StackTraceContent>
            <StackTraceFrames frames={parsed.frames} onFilePathClick={onFilePathClick} />
            <StackTraceRaw trace={stackTrace.trace} />
          </StackTraceContent>
        </>
      )}
    </Collapsible>
  );
}

export type StackTraceHeaderProps = React.ComponentProps<'div'> & {
  parsed: ParsedStackTrace;
  stackTrace: ChatStackTrace;
  open: boolean;
};

export function StackTraceHeader({
  className,
  parsed,
  stackTrace,
  open,
  children,
  ...props
}: StackTraceHeaderProps): React.ReactNode {
  return (
    <div
      className={cn('flex w-full items-center gap-2 px-3 py-2 hover:bg-muted', className)}
      {...props}
    >
      {children ?? (
        <>
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <AlertTriangleIcon className="size-3.5 shrink-0 text-destructive-foreground" />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold text-destructive-foreground">
                {stackTrace.title ?? parsed.errorType ?? 'Error'}
              </span>
              {parsed.errorMessage ? (
                <span className="text-foreground">: {parsed.errorMessage}</span>
              ) : null}
            </span>
            <ChevronRightIcon
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground transition-transform',
                open && 'rotate-90',
              )}
            />
          </CollapsibleTrigger>
          <StackTraceCopyButton trace={stackTrace.trace} />
        </>
      )}
    </div>
  );
}

export type StackTraceContentProps = React.ComponentProps<typeof CollapsibleContent>;

export function StackTraceContent({
  className,
  ...props
}: StackTraceContentProps): React.ReactNode {
  return (
    <CollapsibleContent
      className={cn('border-t border-border bg-muted/30', className)}
      {...props}
    />
  );
}

export type StackTraceFramesProps = React.ComponentProps<'div'> & {
  frames: readonly ParsedStackFrame[];
  showInternalFrames?: boolean;
  onFilePathClick?: (filePath: string, line?: number, column?: number) => void;
};

export function StackTraceFrames({
  className,
  frames,
  showInternalFrames = true,
  onFilePathClick,
  ...props
}: StackTraceFramesProps): React.ReactNode {
  const visibleFrames = showInternalFrames ? frames : frames.filter((frame) => !frame.isInternal);

  return (
    <div className={cn('space-y-1 p-3', className)} {...props}>
      {visibleFrames.length === 0 ? (
        <div className="text-muted-foreground">No stack frames</div>
      ) : (
        keyedItems(visibleFrames, (frame) => frame.raw).map(({ key, item: frame }) => (
          <div
            key={key}
            className={cn(
              'min-w-0 truncate',
              frame.isInternal ? 'text-muted-foreground' : 'text-foreground',
            )}
          >
            <span className="text-muted-foreground">at </span>
            {frame.functionName ? <span>{frame.functionName} </span> : null}
            {frame.filePath ? (
              <button
                className="underline decoration-dotted hover:text-primary disabled:no-underline"
                disabled={!onFilePathClick}
                onClick={() =>
                  onFilePathClick?.(frame.filePath ?? '', frame.lineNumber, frame.columnNumber)
                }
                type="button"
              >
                {frame.filePath}
                {formatStackLocationPart(frame.lineNumber)}
                {formatStackLocationPart(frame.columnNumber)}
              </button>
            ) : (
              <span>{frame.raw.startsWith('at ') ? frame.raw.slice(3) : frame.raw}</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}

export type StackTraceRawProps = React.ComponentProps<'pre'> & {
  trace: string;
};

export function StackTraceRaw({ className, trace, ...props }: StackTraceRawProps): React.ReactNode {
  return (
    <pre
      className={cn(
        'max-h-72 overflow-auto border-t border-border p-3 text-muted-foreground',
        className,
      )}
      {...props}
    >
      {trace}
    </pre>
  );
}

export type StackTraceCopyButtonProps = React.ComponentProps<typeof Button> & {
  trace: string;
  timeout?: number;
};

export function StackTraceCopyButton({
  className,
  trace,
  timeout = 1600,
  children,
  ...props
}: StackTraceCopyButtonProps): React.ReactNode {
  const { copied, copyValue } = useCopyButton(trace, timeout);

  return (
    <Button
      aria-label={copied ? 'Copied stack trace' : 'Copy stack trace'}
      className={cn('shrink-0', className)}
      onClick={(event) => {
        event.stopPropagation();
        copyValue();
      }}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? (copied ? <CheckIcon /> : <CopyIcon />)}
    </Button>
  );
}

function parseStackTrace(trace: string): ParsedStackTrace {
  const lines: string[] = [];
  for (const line of trace.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) lines.push(trimmed);
  }

  const firstLine = lines[0]?.trim() ?? '';
  const error = parseErrorLine(firstLine);
  const frames: ParsedStackFrame[] = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('at ')) frames.push(parseStackFrame(line));
  }

  return {
    errorType: error.errorType,
    errorMessage: error.errorMessage,
    frames,
  };
}

function parseErrorLine(line: string): Pick<ParsedStackTrace, 'errorMessage' | 'errorType'> {
  const separator = line.indexOf(':');
  if (separator <= 0) return { errorMessage: line };

  const possibleType = line.slice(0, separator);
  if (possibleType === 'Error' || possibleType.endsWith('Error')) {
    return {
      errorType: possibleType,
      errorMessage: line.slice(separator + 1).trimStart(),
    };
  }

  return { errorMessage: line };
}

function parseStackFrame(line: string): ParsedStackFrame {
  const trimmed = line.trim();
  const body = trimmed.startsWith('at ') ? trimmed.slice(3) : trimmed;
  let functionName: string | undefined;
  let frameLocation = body;

  const locationStart = body.lastIndexOf(' (');
  if (locationStart >= 0 && body.endsWith(')')) {
    functionName = body.slice(0, locationStart);
    frameLocation = body.slice(locationStart + 2, -1);
  }

  const parsedLocation = parseStackLocation(frameLocation);
  if (parsedLocation) {
    return {
      raw: trimmed,
      functionName,
      ...parsedLocation,
      isInternal: isInternalPath(parsedLocation.filePath),
    };
  }

  return {
    raw: trimmed,
    functionName,
    isInternal: isInternalPath(trimmed),
  };
}

function parseStackLocation(location: string): ParsedStackLocation | null {
  const columnSeparator = location.lastIndexOf(':');
  if (columnSeparator < 0) return null;

  const lineSeparator = location.lastIndexOf(':', columnSeparator - 1);
  if (lineSeparator < 0) return null;

  const filePath = location.slice(0, lineSeparator);
  const lineNumber = Number.parseInt(location.slice(lineSeparator + 1, columnSeparator), 10);
  const columnNumber = Number.parseInt(location.slice(columnSeparator + 1), 10);
  if (!Number.isFinite(lineNumber) || !Number.isFinite(columnNumber)) return null;

  return { columnNumber, filePath, lineNumber };
}

function isInternalPath(path: string): boolean {
  return path.includes('node_modules') || path.startsWith('node:') || path.includes('internal/');
}

function formatStackLocationPart(value: number | undefined): string {
  return typeof value === 'number' ? `:${value}` : '';
}
