import { ListItem, Text } from '@expo/ui/jetpack-compose';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { RowActions } from '@mobile/components/form/row-actions.android';
import { FormSection } from '@mobile/components/form/section.android';
import { useOpenHost } from '@mobile/runtime/use-open-host';
import { useHostRegistryStore } from '@mobile/stores/host-store';
import { useTranslations } from 'use-intl';

export function SavedHostsSection(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const colors = useAppMaterialColors();
  const openHost = useOpenHost();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const removeHost = useHostRegistryStore((state) => state.removeHost);

  return (
    <FormSection title={t('savedHosts')}>
      {hosts.map((host) => (
        <RowActions
          key={host.id}
          onPress={() => openHost(host.id)}
          actions={[{ label: t('remove'), destructive: true, onPress: () => removeHost(host.id) }]}
        >
          <ListItem>
            <ListItem.HeadlineContent>
              <Text>{host.name}</Text>
            </ListItem.HeadlineContent>
            <ListItem.SupportingContent>
              <Text style={{ typography: 'bodySmall' }} color={colors.onSurfaceVariant}>
                {'url' in host ? host.url : t('viaTunnel')}
              </Text>
            </ListItem.SupportingContent>
          </ListItem>
        </RowActions>
      ))}
    </FormSection>
  );
}
