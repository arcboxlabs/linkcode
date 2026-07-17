import { useImperativeHandle } from 'react';
import { Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import type { TerminalRendererProps } from './terminal-renderer.types';

/**
 * Non-native fallback. `expo-libghostty` only registers a native view, so
 * this variant must never import it — Metro resolves
 * `terminal-renderer.native.tsx` on iOS/Android and this file everywhere else
 * (web).
 */
export default function TerminalRenderer({ ref }: TerminalRendererProps): React.ReactNode {
  const t = useTranslations('mobile.terminal');
  useImperativeHandle(
    ref,
    () => ({
      events() {
        // No surface to render into off the native platforms.
      },
      exit() {
        // No surface to render into off the native platforms.
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
