import { ListItem, Text, TextButton } from '@expo/ui/jetpack-compose';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { RowActions } from '@mobile/components/form/row-actions.android';
import { FormHint, FormLoadingRow } from '@mobile/components/form/rows.android';
import { FormSection } from '@mobile/components/form/section.android';
import { useDevicesSection } from '@mobile/runtime/use-devices-section';
import { useTranslations } from 'use-intl';

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
          <RowActions
            key={device.id}
            actions={[
              {
                label: t('revoke'),
                destructive: true,
                disabled: busyId !== null,
                onPress: () => confirmRevoke(device),
              },
            ]}
          >
            <ListItem>
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
            </ListItem>
          </RowActions>
        ))
      )}
    </FormSection>
  );
}
