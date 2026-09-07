import { Text, TextButton } from '@expo/ui/jetpack-compose';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { FormHint, FormLoadingRow } from '@mobile/components/form/rows.android';
import { FormSection } from '@mobile/components/form/section.android';
import { useMyMachines } from '@mobile/runtime/use-my-machines';
import { useTranslations } from 'use-intl';

/** Android online machines; the view model lives in `use-my-machines`. */
export function MyMachinesSection({ userId }: { userId: string }): React.ReactNode {
  const t = useTranslations('mobile.connect.cloud');
  const { onlineHosts, hostsError, refresh, saveAndOpen } = useMyMachines(userId);

  return (
    <FormSection
      title={t('machines')}
      trailing={
        <TextButton onClick={refresh}>
          <Text>{t('refresh')}</Text>
        </TextButton>
      }
    >
      {hostsError ? (
        <FormHint tone="error">{t('error')}</FormHint>
      ) : onlineHosts === null ? (
        <FormLoadingRow />
      ) : onlineHosts.length === 0 ? (
        <FormHint>{t('empty')}</FormHint>
      ) : (
        onlineHosts.map((host) => (
          <NavigationRow
            key={host.hostId}
            title={host.name ?? host.hostId.slice(0, 8)}
            subtitle={t('title')}
            onPress={() => saveAndOpen(host)}
          />
        ))
      )}
    </FormSection>
  );
}
