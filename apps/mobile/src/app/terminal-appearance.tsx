import { TerminalAppearanceScreen } from '@mobile/components/settings/terminal-appearance-screen';
import { VISIBLE_HEADER_OPTIONS } from '@mobile/components/shell/use-stack-screen-options';
import { Stack } from 'expo-router';
import { useTranslations } from 'use-intl';

export default function TerminalAppearanceRoute(): React.ReactNode {
  const t = useTranslations('mobile.terminalAppearance');

  return (
    <>
      <Stack.Screen options={{ ...VISIBLE_HEADER_OPTIONS, title: t('title') }} />
      <TerminalAppearanceScreen />
    </>
  );
}
