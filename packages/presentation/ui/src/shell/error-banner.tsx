import { Alert, AlertAction, AlertDescription, AlertTitle } from 'coss-ui/components/alert';
import { Button } from 'coss-ui/components/button';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { normalizeErrorMessage } from '../lib/error-text';

/** Full-width banner for surfaces without a title strip (the new-session page); conversation
 * surfaces show the compact `ErrorBadge` beside the title instead (CODE-239). */
export function ErrorBanner({
  errorMessage,
  onDismissError,
}: {
  errorMessage?: string | null;
  onDismissError?: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.errors');
  if (!errorMessage) return null;

  return (
    <div className="border-border border-b px-4 py-2">
      <Alert variant="error" className="rounded-md py-2">
        <AlertTitle>{t('actionFailed')}</AlertTitle>
        <AlertDescription>{normalizeErrorMessage(errorMessage)}</AlertDescription>
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
