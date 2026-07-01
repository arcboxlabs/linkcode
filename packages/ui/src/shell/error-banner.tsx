import { Alert, AlertAction, AlertDescription, AlertTitle } from 'coss-ui/components/alert';
import { Button } from 'coss-ui/components/button';
import { XIcon } from 'lucide-react';

export function ErrorBanner({
  errorMessage,
  onDismissError,
}: {
  errorMessage?: string | null;
  onDismissError?: () => void;
}): React.ReactNode {
  if (!errorMessage) return null;

  return (
    <div className="border-border border-b px-4 py-2">
      <Alert variant="error" className="rounded-md py-2">
        <AlertTitle>Action failed</AlertTitle>
        <AlertDescription>{errorMessage}</AlertDescription>
        {onDismissError && (
          <AlertAction>
            <Button size="icon-xs" variant="ghost" aria-label="Dismiss" onClick={onDismissError}>
              <XIcon />
            </Button>
          </AlertAction>
        )}
      </Alert>
    </div>
  );
}
