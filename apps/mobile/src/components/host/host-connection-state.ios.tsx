import { Button, Host, Image, Text, VStack } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  font,
  multilineTextAlignment,
  textSelection,
} from '@expo/ui/swift-ui/modifiers';
import { LoadingView } from '@mobile/components/form/loading-view.ios';
import { FOOTNOTE, SECONDARY } from '@mobile/components/form/styles.ios';
import type { HostConnectionStateProps } from '@mobile/components/host/host-connection-state.types';
import { useTranslations } from 'use-intl';

const CENTERED = multilineTextAlignment('center');
const TITLE = font({ textStyle: 'title2', weight: 'semibold' });

/** Full-screen fallback shown while a host connection is being established or has failed. */
export function HostConnectionState({
  status,
  url,
  failure,
  onRetry,
}: HostConnectionStateProps): React.ReactNode {
  const t = useTranslations('mobile.connection');

  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      {status === 'connecting' ? (
        <LoadingView />
      ) : (
        <VStack spacing={16}>
          <Image systemName="wifi.exclamationmark" size={44} modifiers={[SECONDARY]} />
          <VStack spacing={6}>
            <Text modifiers={[TITLE, CENTERED]}>{t('unavailableTitle')}</Text>
            <Text modifiers={[SECONDARY, CENTERED, textSelection(true)]}>
              {t('error', { url })}
            </Text>
          </VStack>
          <Button
            label={t('retry')}
            systemImage="arrow.clockwise"
            modifiers={[buttonStyle('borderedProminent')]}
            onPress={onRetry}
          />
          {failure ? (
            <Text modifiers={[FOOTNOTE, SECONDARY, CENTERED, textSelection(true)]}>{failure}</Text>
          ) : null}
        </VStack>
      )}
    </Host>
  );
}
