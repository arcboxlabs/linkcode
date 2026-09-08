import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogPopup,
  AlertDialogTitle,
} from 'coss-ui/components/alert-dialog';
import { Button } from 'coss-ui/components/button';
import { useEffect } from 'foxact/use-abortable-effect';
import { useTranslations } from 'use-intl';
import { useAutomationDraftState } from './draft-state';

export function useAutomationDraft(dirty: boolean): void {
  useEffect(() => {
    useAutomationDraftState.getState().setDirty(dirty);
    return () => useAutomationDraftState.getState().setDirty(false);
  }, [dirty]);
}

export function AutomationDraftGuard(): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const pending = useAutomationDraftState((state) => state.pending);
  const discard = useAutomationDraftState((state) => state.discard);
  const stay = useAutomationDraftState((state) => state.stay);
  const dirty = useAutomationDraftState((state) => state.dirty);
  useEffect(
    (signal) => {
      if (!dirty) return;
      const handler = (event: BeforeUnloadEvent): void => {
        event.preventDefault();
      };
      window.addEventListener('beforeunload', handler, { signal });
    },
    [dirty],
  );
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) stay();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogTitle>{t('discardTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{t('discardDescription')}</AlertDialogDescription>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={stay}>
            {t('keepEditing')}
          </Button>
          <Button variant="destructive" onClick={discard}>
            {t('discard')}
          </Button>
        </div>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
