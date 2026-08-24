import { Button, Text as ComposeText } from '@expo/ui/jetpack-compose';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { LoadingView } from '@mobile/components/form/loading-view.android';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import type { HostConnectionStateProps } from '@mobile/components/host/host-connection-state.types';
import { WifiOffIcon } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { useTranslations } from 'use-intl';

/** Android full-screen fallback while a host connection is being established or has failed.
 * The text stays RN so the failure detail remains selectable (Compose text cannot offer that);
 * colors come from the Material palette so it matches the Compose surfaces around it. */
export function HostConnectionState({
  status,
  url,
  failure,
  onRetry,
}: HostConnectionStateProps): React.ReactNode {
  const t = useTranslations('mobile.connection');
  const colors = useAppMaterialColors();

  if (status === 'connecting') return <LoadingView />;

  return (
    <View className="flex-1 items-center justify-center gap-4 px-6">
      <WifiOffIcon size={44} color={colors.onSurfaceVariant} strokeWidth={1.5} />
      <View className="items-center gap-1.5">
        <Text className="text-center font-semibold text-title" style={{ color: colors.onSurface }}>
          {t('unavailableTitle')}
        </Text>
        <Text selectable className="text-center" style={{ color: colors.onSurfaceVariant }}>
          {t('error', { url })}
        </Text>
      </View>
      <ThemedHost matchContents>
        <Button onClick={onRetry}>
          <ComposeText>{t('retry')}</ComposeText>
        </Button>
      </ThemedHost>
      {failure ? (
        <Text
          selectable
          className="text-center text-footnote"
          style={{ color: colors.onSurfaceVariant }}
        >
          {failure}
        </Text>
      ) : null}
    </View>
  );
}
