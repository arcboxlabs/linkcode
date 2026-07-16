import { useImperativeHandle } from 'react';
import { Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import type { TerminalRendererProps } from './terminal-renderer.types';

/**
 * Non-iOS fallback — must never import `expo-libghostty` (Apple-only native view);
 * Metro picks `terminal-renderer.ios.tsx` on iOS. Android is a separate gated effort.
 */
export default function TerminalRenderer({ ref }: TerminalRendererProps): React.ReactNode {
  const t = useTranslations('mobile.terminal');
  useImperativeHandle(
    ref,
    () => ({
      events() {
        // No surface to render into off iOS.
      },
      exit() {
        // No surface to render into off iOS.
      },
    }),
    [],
  );

  return (
    <View className="flex-1 items-center justify-center px-6">
      <Text className="text-center text-[13px] text-muted">{t('unsupportedPlatform')}</Text>
    </View>
  );
}
