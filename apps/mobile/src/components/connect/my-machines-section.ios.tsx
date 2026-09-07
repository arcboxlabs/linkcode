import { Button, HStack, Section, Spacer, Text } from '@expo/ui/swift-ui';
import { buttonStyle, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { FormLoadingRow } from '@mobile/components/form/loading-view.ios';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { FOOTNOTE, SECONDARY } from '@mobile/components/form/styles.ios';
import { useMyMachines } from '@mobile/runtime/use-my-machines';
import { useTranslations } from 'use-intl';

/** Online machines; the view model lives in `use-my-machines`. */
export function MyMachinesSection({ userId }: { userId: string }): React.ReactNode {
  const t = useTranslations('mobile.connect.cloud');
  const { onlineHosts, hostsError, refresh, saveAndOpen } = useMyMachines(userId);

  return (
    // A titled Section can't also carry an action, so the header is drawn by hand —
    // footnote + secondary is what SwiftUI gives a plain `title` on iOS.
    <Section
      header={
        <HStack>
          <Text modifiers={[FOOTNOTE, SECONDARY]}>{t('machines')}</Text>
          <Spacer />
          <Button
            label={t('refresh')}
            onPress={refresh}
            modifiers={[buttonStyle('plain'), FOOTNOTE]}
          />
        </HStack>
      }
    >
      {hostsError ? (
        <Text modifiers={[foregroundStyle('red')]}>{t('error')}</Text>
      ) : onlineHosts === null ? (
        <FormLoadingRow />
      ) : onlineHosts.length === 0 ? (
        <Text modifiers={[SECONDARY]}>{t('empty')}</Text>
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
    </Section>
  );
}
