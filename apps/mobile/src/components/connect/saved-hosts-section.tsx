import { ListItem, Text, TextButton } from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { FormSection } from '@mobile/components/form/section.android';
import { useOpenHost } from '@mobile/runtime/use-open-host';
import { useHostRegistryStore } from '@mobile/stores/host-store';
import { useTranslations } from 'use-intl';

/** Android saved hosts. Compose has no SwipeActions, so removal is a visible trailing text
 * button; the rest of the row stays a single tap target for opening the host. */
export function SavedHostsSection(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const colors = useAppMaterialColors();
  const openHost = useOpenHost();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const removeHost = useHostRegistryStore((state) => state.removeHost);

  return (
    <FormSection title={t('savedHosts')}>
      {hosts.map((host) => (
        <ListItem key={host.id} modifiers={[clickable(() => openHost(host.id))]}>
          <ListItem.HeadlineContent>
            <Text>{host.name}</Text>
          </ListItem.HeadlineContent>
          <ListItem.SupportingContent>
            <Text style={{ typography: 'bodySmall' }} color={colors.onSurfaceVariant}>
              {'url' in host ? host.url : t('viaTunnel')}
            </Text>
          </ListItem.SupportingContent>
          <ListItem.TrailingContent>
            <TextButton colors={{ contentColor: colors.error }} onClick={() => removeHost(host.id)}>
              <Text>{t('remove')}</Text>
            </TextButton>
          </ListItem.TrailingContent>
        </ListItem>
      ))}
    </FormSection>
  );
}
