import { ListItem, Text, TextButton } from '@expo/ui/jetpack-compose';
import { useDevicesSection } from '@mobile/components/account/use-devices-section';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { FormHint, FormLoadingRow } from '@mobile/components/form/rows.android';
import { FormSection } from '@mobile/components/form/section.android';
import { useTranslations } from 'use-intl';

/** Android device registry; the view model lives in `use-devices-section`. Compose has no
 * SwipeActions, so revoke is a visible trailing text button — the MD3-discoverable shape for a
 * destructive-only row action. */
export function DevicesSection(): React.ReactNode {
  const t = useTranslations('mobile.account');
  const colors = useAppMaterialColors();
  const { devices, devicesError, enrolledId, busyId, refresh, confirmRevoke, describeDevice } =
    useDevicesSection();

  return (
    <FormSection
      title={t('devices')}
      trailing={
        <TextButton onClick={refresh}>
          <Text>{t('refresh')}</Text>
        </TextButton>
      }
    >
      {devicesError ? (
        <FormHint tone="error">{t('devicesError')}</FormHint>
      ) : devices === null ? (
        <FormLoadingRow />
      ) : devices.length === 0 ? (
        <FormHint>{t('devicesEmpty')}</FormHint>
      ) : (
        devices.map((device) => (
          <ListItem key={device.id}>
            <ListItem.HeadlineContent>
              <Text>{device.name}</Text>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <Text style={{ typography: 'bodySmall' }} color={colors.onSurfaceVariant}>
                {device.id === enrolledId
                  ? `${describeDevice(device)} · ${t('thisDevice')}`
                  : describeDevice(device)}
              </Text>
            </ListItem.SupportingContent>
            <ListItem.TrailingContent>
              <TextButton
                enabled={busyId === null}
                colors={{ contentColor: colors.error }}
                onClick={() => confirmRevoke(device)}
              >
                <Text>{t('revoke')}</Text>
              </TextButton>
            </ListItem.TrailingContent>
          </ListItem>
        ))
      )}
    </FormSection>
  );
}
