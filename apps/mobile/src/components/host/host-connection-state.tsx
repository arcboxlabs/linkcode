import type { HostConnectionStateProps } from '@mobile/components/host/host-connection-state.types';
import { Button, useThemeColor } from 'heroui-native';
import { WifiOffIcon } from 'lucide-react-native';
import { ActivityIndicator, Text, View } from 'react-native';
import { useTranslations } from 'use-intl';

/** Android full-screen fallback while a host connection is being established or has failed.
 * Deliberately plain RN: the failure text stays selectable (`selectable`), which Compose text
 * cannot offer, and nothing here is list chrome that would want MD3 dress. */
export function HostConnectionState({
  status,
  url,
  failure,
  onRetry,
}: HostConnectionStateProps): React.ReactNode {
  const t = useTranslations('mobile.connection');
  const muted = useThemeColor('muted');

  return (
    <View className="flex-1 items-center justify-center gap-4 px-6">
      {status === 'connecting' ? (
        <>
          <ActivityIndicator />
          <Text className="text-muted">{t('connecting')}</Text>
        </>
      ) : (
        <>
          <WifiOffIcon size={44} color={muted} strokeWidth={1.5} />
          <View className="items-center gap-1.5">
            <Text className="text-center font-semibold text-foreground text-title">
              {t('unavailableTitle')}
            </Text>
            <Text selectable className="text-center text-muted">
              {t('error', { url })}
            </Text>
          </View>
          <Button onPress={onRetry}>
            <Button.Label>{t('retry')}</Button.Label>
          </Button>
          {failure ? (
            <Text selectable className="text-center text-footnote text-muted">
              {failure}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
