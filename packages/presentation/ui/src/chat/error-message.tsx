import { Button } from 'coss-ui/components/button';
import { TriangleAlertIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { normalizeErrorMessage } from '../lib/error-text';
import { Message, MessageContent } from './message';

/** An agent error event, rendered as a message-shaped card in red mono type (CODE-239). */
export function ErrorMessage({
  message,
  code,
  recoverable,
  onOpenBilling,
}: {
  message: string;
  code?: string;
  recoverable: boolean;
  onOpenBilling?: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.conversation');
  const insufficientCredits = code === 'insufficient_credits';
  const billingUnavailable = code === 'billing_unavailable';
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
          <div className="min-w-0 flex-1 text-destructive-foreground text-xs leading-relaxed">
            {insufficientCredits || billingUnavailable ? (
              <div className="space-y-1">
                <div className="font-medium text-sm">
                  {t(insufficientCredits ? 'insufficientCreditsTitle' : 'billingUnavailableTitle')}
                </div>
                <div className="text-muted-foreground">
                  {t(insufficientCredits ? 'insufficientCreditsHint' : 'billingUnavailableHint')}
                </div>
                {insufficientCredits && onOpenBilling ? (
                  <Button type="button" size="sm" className="mt-2" onClick={onOpenBilling}>
                    {t('topUpCredits')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="whitespace-pre-wrap break-words font-mono">
                {normalizeErrorMessage(message)}
                {code ? <span className="ml-2 opacity-64">({code})</span> : null}
              </div>
            )}
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}
