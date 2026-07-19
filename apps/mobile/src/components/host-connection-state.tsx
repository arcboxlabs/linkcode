import { Button, Spinner } from 'heroui-native';
import { Text, View } from 'react-native';
import { useTranslations } from 'use-intl';

export interface HostConnectionStateProps {
  status: 'connecting' | 'error';
  url: string;
  onRetry: () => void;
}

/** Full-screen fallback shown while a host connection is being established or has failed. */
export function HostConnectionState({
  status,
  url,
  onRetry,
}: HostConnectionStateProps): React.ReactNode {
  const t = useTranslations('mobile.connection');

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background p-8">
      {status === 'connecting' ? (
        <>
          <Spinner />
          <Text className="text-body text-muted">{t('connecting')}</Text>
        </>
      ) : (
        <>
          <Text className="text-center text-body text-foreground">{t('error', { url })}</Text>
          <Button onPress={onRetry}>
            <Button.Label>{t('retry')}</Button.Label>
          </Button>
        </>
      )}
    </View>
  );
}
