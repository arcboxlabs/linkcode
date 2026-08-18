import { HostClientGate } from '@mobile/components/host/host-client-gate';
import { ThreadsScreen } from '@mobile/components/host/threads-screen';
import { useHostHeaderOptions } from '@mobile/components/host/use-host-header-options';
import type { PrimaryAction } from '@mobile/components/shell/primary-action';
import { usePrimaryAction } from '@mobile/components/shell/primary-action';
import { PrimaryActionFab } from '@mobile/components/shell/primary-action-fab';
import { VISIBLE_HEADER_OPTIONS } from '@mobile/components/shell/use-stack-screen-options';
import { useTrailingActions } from '@mobile/components/shell/use-trailing-actions';
import { useHostConnection } from '@mobile/runtime/host-connection';
import { Stack, useRouter } from 'expo-router';
import { SquarePenIcon } from 'lucide-react-native';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

/** The header outlives the connection: it carries the host switcher, which is the way out of a host
 * that cannot be reached, so it is mounted above the gate rather than inside it. New-thread needs a
 * client, so its entry points are dropped until the connection is ready. */
export default function ThreadsRoute(): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const router = useRouter();
  const hostHeaderOptions = useHostHeaderOptions();
  const connection = useHostConnection();

  const primaryAction: PrimaryAction | null =
    connection?.status === 'ready'
      ? {
          sf: 'square.and.pencil',
          icon: SquarePenIcon,
          label: t('newThread'),
          onPress: () => router.push('/new-thread'),
        }
      : null;
  usePrimaryAction('threads', primaryAction);
  const trailingActions = useTrailingActions(primaryAction);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          ...VISIBLE_HEADER_OPTIONS,
          title: t('title'),
          ...hostHeaderOptions,
          ...trailingActions,
        }}
      />
      <HostClientGate>
        <ThreadsScreen />
      </HostClientGate>
      <PrimaryActionFab action={primaryAction} />
    </View>
  );
}
