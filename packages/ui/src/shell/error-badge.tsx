import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from 'coss-ui/components/preview-card';
import { CircleAlertIcon, XIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { normalizeErrorMessage } from '../lib/error-text';

/**
 * Title-side surface for the last failed action (CODE-239): a compact badge whose full error
 * message only shows in a hover card, replacing the old always-on banner. Renders nothing
 * without an error.
 */
export function ErrorBadge({
  errorMessage,
  onDismissError,
  className,
}: {
  errorMessage?: string | null;
  onDismissError?: () => void;
  className?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.errors');
  if (!errorMessage) return null;

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={300}
        render={
          <Badge
            variant="error"
            className={cn('shrink-0 border-destructive/32 px-1.5', className)}
          />
        }
      >
        <CircleAlertIcon />
        {t('actionFailed')}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-96 max-w-[min(24rem,90vw)] flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-destructive-foreground text-sm">
            {t('actionFailed')}
          </span>
          {onDismissError && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={t('dismiss')}
              onClick={onDismissError}
            >
              <XIcon />
            </Button>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
          {normalizeErrorMessage(errorMessage)}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
