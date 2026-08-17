import {
  Button,
  HStack,
  ProgressView,
  Section,
  Spacer,
  SwipeActions,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import { badge, buttonStyle, disabled, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { useDevicesSection } from '@mobile/components/account/use-devices-section';
import { FOOTNOTE, SECONDARY } from '@mobile/components/form/styles.ios';
import { useTranslations } from 'use-intl';

/** The account's registered devices; the view model lives in `use-devices-section`. */
export function DevicesSection(): React.ReactNode {
  const t = useTranslations('mobile.account');
  const { devices, devicesError, enrolledId, busyId, refresh, confirmRevoke, describeDevice } =
    useDevicesSection();

  return (
    // A titled Section can't also carry an action, so the header is drawn by hand.
    <Section
      header={
        <HStack>
          <Text modifiers={[FOOTNOTE, SECONDARY]}>{t('devices')}</Text>
          <Spacer />
          <Button
            label={t('refresh')}
            onPress={refresh}
            modifiers={[buttonStyle('plain'), FOOTNOTE]}
          />
        </HStack>
      }
    >
      {devicesError ? (
        <Text modifiers={[foregroundStyle('red')]}>{t('devicesError')}</Text>
      ) : devices === null ? (
        <ProgressView />
      ) : devices.length === 0 ? (
        <Text modifiers={[SECONDARY]}>{t('devicesEmpty')}</Text>
      ) : (
        devices.map((device) => (
          // Revoking is the row's swipe action, matching how saved hosts are removed.
          <SwipeActions key={device.id}>
            <SwipeActions.Actions>
              <Button
                role="destructive"
                label={t('revoke')}
                onPress={() => confirmRevoke(device)}
                modifiers={[disabled(busyId !== null)]}
              />
            </SwipeActions.Actions>
            <VStack
              alignment="leading"
              spacing={2}
              modifiers={[device.id === enrolledId ? badge(t('thisDevice')) : badge()]}
            >
              <Text>{device.name}</Text>
              <Text modifiers={[FOOTNOTE, SECONDARY]}>{describeDevice(device)}</Text>
            </VStack>
          </SwipeActions>
        ))
      )}
    </Section>
  );
}
