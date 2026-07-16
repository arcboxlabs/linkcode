import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from 'coss-ui/components/alert-dialog';
import { Button } from 'coss-ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';
import { XIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { PromptPager } from './prompt-pager';

export function QuestionPromptActions({
  canGoNext,
  current,
  disabled,
  dismissLoading,
  hasDrafts,
  queuedCount,
  total,
  onDismiss,
  onNext,
  onPrevious,
}: {
  canGoNext: boolean;
  current: number;
  disabled: boolean;
  dismissLoading: boolean;
  hasDrafts: boolean;
  queuedCount: number;
  total: number;
  onDismiss: () => void;
  onNext: () => void;
  onPrevious: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.question');

  return (
    <div className="flex items-center gap-1">
      <PromptPager
        current={current}
        disabled={disabled}
        label={t('navigation')}
        nextLabel={t('next')}
        nextDisabled={!canGoNext}
        previousLabel={t('previous')}
        queued={queuedCount}
        total={total}
        onNext={onNext}
        onPrevious={onPrevious}
      />
      <DismissRequestButton
        disabled={disabled}
        hasDrafts={hasDrafts}
        loading={dismissLoading}
        onDismiss={onDismiss}
      />
    </div>
  );
}

function DismissRequestButton({
  disabled,
  hasDrafts,
  loading,
  onDismiss,
}: {
  disabled: boolean;
  hasDrafts: boolean;
  loading: boolean;
  onDismiss: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.question');
  const button = (
    <Button
      aria-label={t('dismiss')}
      disabled={disabled}
      loading={loading}
      size="icon-xs"
      variant="ghost"
      onClick={hasDrafts ? undefined : onDismiss}
    >
      <XIcon />
    </Button>
  );

  if (!hasDrafts) {
    return (
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent side="bottom">{t('dismiss')}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <AlertDialog>
      <Tooltip>
        <AlertDialogTrigger render={<TooltipTrigger render={button} />} />
        <TooltipContent side="bottom">{t('dismiss')}</TooltipContent>
      </Tooltip>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('dismissConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('dismissConfirmDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose
            render={
              <Button size="sm" variant="outline">
                {t('dismissConfirmCancel')}
              </Button>
            }
          />
          <AlertDialogClose
            render={
              <Button size="sm" variant="destructive" onClick={onDismiss}>
                {t('dismissConfirmAction')}
              </Button>
            }
          />
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
