import { Alert, AlertTitle } from 'coss-ui/components/alert';
import { TriangleAlertIcon } from 'lucide-react';
import { cn } from '../lib/cn';

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
    <Alert
      className={cn('my-1', !recoverable && 'border-destructive/48 bg-destructive/8')}
      variant="error"
    >
      <TriangleAlertIcon />
      <AlertTitle className="break-words font-normal">
        {message}
        {code ? <span className="ml-2 text-muted-foreground">({code})</span> : null}
      </AlertTitle>
    </Alert>
  );
}
