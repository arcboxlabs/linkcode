import { TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { cn } from '../lib/cn';

export function ErrorMessage({
  message,
  code,
  recoverable,
}: {
  message: string;
  code?: string;
  recoverable: boolean;
}): ReactElement {
  return (
    <div
      className={cn(
        'my-1 flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] text-destructive-foreground',
        recoverable
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-destructive/50 bg-destructive/10',
      )}
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words">
        <span>{message}</span>
        {code ? <span className="ml-2 text-muted-foreground">({code})</span> : null}
      </div>
    </div>
  );
}
