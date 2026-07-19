import { TriangleAlertIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { normalizeErrorMessage } from '../lib/error-text';
import { Message, MessageContent } from './message';

/** An agent error event, rendered as a message-shaped card in red mono type (CODE-239). */
export function ErrorMessage({
  message,
  code,
  recoverable,
}: {
  message: string;
  code?: string;
  recoverable: boolean;
}): React.ReactNode {
  return (
    <Message from="assistant">
      <MessageContent>
        <div
          className={cn(
            'flex items-start gap-2.5 rounded-2xl rounded-bl border border-destructive/24 bg-destructive/4 px-3.5 py-2.5',
            !recoverable && 'border-destructive/48 bg-destructive/8',
          )}
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive-foreground" />
          <div className="min-w-0 whitespace-pre-wrap break-words font-mono text-destructive-foreground text-xs leading-relaxed">
            {normalizeErrorMessage(message)}
            {code ? <span className="ml-2 opacity-64">({code})</span> : null}
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}
