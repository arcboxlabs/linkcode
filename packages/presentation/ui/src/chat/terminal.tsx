import AnsiImport from 'ansi-to-react';
import { Frame } from 'coss-ui/components/frame';
import { TerminalIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { ChatCardActions, ChatCardHeader, ChatCardPanel, ChatCardTitle } from './chat-card';
import { CopyIconButton } from './copy-icon-button';
import { Shimmer } from './shimmer';

type AnsiComponent = typeof AnsiImport;

// ansi-to-react is CommonJS with its component stored on `exports.default` while also
// advertising `__esModule`; Vite 8 therefore exposes either the component or that wrapper.
const ansiModule = AnsiImport as AnsiComponent | { default: AnsiComponent };
const Ansi = typeof ansiModule === 'function' ? ansiModule : ansiModule.default;

/** Drops blank tail lines only — trailing spaces on the last content line stay (prompt
 * padding, ANSI-colored blocks). A scan, not a regex: output is unbounded input and
 * `q+$`-style patterns backtrack polynomially on it. */
function trimTrailingNewlines(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === '\r')) end -= 1;
  return text.slice(0, end);
}

export interface TerminalProps extends React.ComponentProps<typeof Frame> {
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
    <Frame className={cn('my-1', className)} {...props}>
      {children ?? (
        <>
          <ChatCardHeader>
            <TerminalTitle>{title}</TerminalTitle>
            <ChatCardActions>
              {isStreaming ? <Shimmer className="text-xs">running</Shimmer> : null}
              {title ? <CopyIconButton label="command" value={title} /> : null}
            </ChatCardActions>
          </ChatCardHeader>
          {output?.trim() ? <TerminalContent>{output}</TerminalContent> : null}
        </>
      )}
    </Frame>
  );
}

export type TerminalTitleProps = React.ComponentProps<typeof ChatCardTitle>;

export function TerminalTitle({
  className,
  children,
  ...props
}: TerminalTitleProps): React.ReactNode {
  return (
    <ChatCardTitle className={cn('flex items-center gap-2 font-mono', className)} {...props}>
      <TerminalIcon className="size-3.5 shrink-0" />
      <span className="truncate">{children ?? 'Terminal'}</span>
    </ChatCardTitle>
  );
}

export type TerminalContentProps = React.ComponentProps<'pre'>;

export function TerminalContent({
  className,
  children,
  ...props
}: TerminalContentProps): React.ReactNode {
  return (
    // overflow-hidden clips the pre's own terminal surface to the panel radius.
    <ChatCardPanel className="overflow-hidden p-0">
      <pre
        className={cn(
          'chat-terminal-output max-h-80 overflow-auto px-3 py-2 font-mono text-xs leading-relaxed',
          className,
        )}
        {...props}
      >
        {typeof children === 'string' ? (
          <Ansi useClasses linkify={false}>
            {/* PTY buffers and stdout end in newlines; blank tail lines read as dead space. */}
            {trimTrailingNewlines(children)}
          </Ansi>
        ) : (
          children
        )}
      </pre>
    </ChatCardPanel>
  );
}
