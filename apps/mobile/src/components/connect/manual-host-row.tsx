import { AddHostSheet } from '@mobile/components/connect/add-host-sheet.android';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

/** Android opens the add-host form as a bottom sheet in place — the same modal family as the
 * host and model switchers — instead of pushing the form-sheet route iOS uses. */
export function ManualHostRow(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const [open, setOpen] = useState(false);

  return (
    <>
      <NavigationRow title={t('addManually')} onPress={() => setOpen(true)} />
      <AddHostSheet isPresented={open} onIsPresentedChange={setOpen} />
    </>
  );
}
