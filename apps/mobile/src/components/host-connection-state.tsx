import { Button, Host, ProgressView, Text, VStack } from '@expo/ui/swift-ui';
import { foregroundStyle, multilineTextAlignment } from '@expo/ui/swift-ui/modifiers';
import { useTranslations } from 'use-intl';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

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
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <VStack spacing={16}>
        {status === 'connecting' ? (
          <>
            <ProgressView />
            <Text modifiers={[SECONDARY]}>{t('connecting')}</Text>
          </>
        ) : (
          <>
            <Text modifiers={[multilineTextAlignment('center')]}>{t('error', { url })}</Text>
            <Button label={t('retry')} onPress={onRetry} />
          </>
        )}
      </VStack>
    </Host>
  );
}
