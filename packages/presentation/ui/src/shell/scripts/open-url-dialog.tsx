import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from 'coss-ui/components/alert-dialog';
import { Button } from 'coss-ui/components/button';
import { Checkbox } from 'coss-ui/components/checkbox';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

/** "Open preview link in-app or externally?" prompt (paseo's ask behavior), with an
 * optional remember-my-choice that the host persists. */
export function OpenUrlChoiceDialog({
  url,
  onOpenChange,
  onChoose,
}: {
  /** The link awaiting a decision; null keeps the dialog closed. */
  url: string | null;
  onOpenChange: (open: boolean) => void;
  onChoose: (choice: 'in-app' | 'external', remember: boolean) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.preview');
  const [remember, setRemember] = useState(false);

  return (
    <AlertDialog open={url !== null} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('openTitle')}</AlertDialogTitle>
          <AlertDialogDescription className="break-all font-mono text-xs">
            {url}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="flex cursor-pointer items-center gap-2 px-1 text-muted-foreground text-sm">
          <Checkbox checked={remember} onCheckedChange={setRemember} />
          {t('rememberChoice')}
        </label>
        <AlertDialogFooter>
          <Button variant="outline" size="sm" onClick={() => onChoose('external', remember)}>
            {t('openExternal')}
          </Button>
          <Button size="sm" onClick={() => onChoose('in-app', remember)}>
            {t('openInApp')}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
