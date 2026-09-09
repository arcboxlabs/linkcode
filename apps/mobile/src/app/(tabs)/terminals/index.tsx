import { HostClientGate } from '@mobile/components/host/host-client-gate';
import { useHostHeaderOptions } from '@mobile/components/host/use-host-header-options';
import type { PrimaryAction } from '@mobile/components/shell/primary-action';
import { usePrimaryAction } from '@mobile/components/shell/primary-action';
import { PrimaryActionFab } from '@mobile/components/shell/primary-action-fab';
import { VISIBLE_HEADER_OPTIONS } from '@mobile/components/shell/use-stack-screen-options';
import { useTrailingActions } from '@mobile/components/shell/use-trailing-actions';
import { TerminalsScreen } from '@mobile/components/terminal/terminals-screen';
import { useNativePalette } from '@mobile/components/theme/native-palette';
import { useHostConnection } from '@mobile/runtime/host-connection';
import { Stack } from 'expo-router';
import { PlusIcon } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

/** Header above the gate, for the same reason as the threads tab: the host switcher has to stay
 * reachable when the host is not. */
export default function TerminalsRoute(): React.ReactNode {
  const t = useTranslations('mobile.terminals');
  const hostHeaderOptions = useHostHeaderOptions();
  const palette = useNativePalette();
  const connection = useHostConnection();
  const [sheetOpen, setSheetOpen] = useState(false);

  const primaryAction: PrimaryAction | null =
    connection?.status === 'ready'
      ? {
          sf: 'plus',
          icon: PlusIcon,
          label: t('newTerminal'),
          onPress: () => setSheetOpen(true),
        }
      : null;
  usePrimaryAction('terminals', primaryAction);
  const trailingActions = useTrailingActions(primaryAction);

  // The flex container is load-bearing: a SwiftUI host left as the screen's direct child is
  // proposed the whole window and paints straight over the navigation header.
  return (
    <View className="flex-1" style={{ backgroundColor: palette.background }}>
      <Stack.Screen
        options={{
          ...VISIBLE_HEADER_OPTIONS,
          title: t('title'),
          ...hostHeaderOptions,
          ...trailingActions,
        }}
      />
      <HostClientGate>
        <TerminalsScreen
          key={connection?.host.id}
          sheetOpen={sheetOpen}
          onSheetOpenChange={setSheetOpen}
        />
      </HostClientGate>
      <PrimaryActionFab action={primaryAction} />
    </View>
  );
}
