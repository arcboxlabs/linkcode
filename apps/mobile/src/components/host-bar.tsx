import { PlusIcon, SettingsIcon } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { HeaderIconButton } from './navigation';

/** Bottom host bar: connection dot + host name, plus new-thread and settings actions.
 * Rendered only inside a ready host connection, so the dot is always green. */
export function HostBar({
  hostName,
  onNewThread,
  onOpenSettings,
}: {
  hostName: string;
  onNewThread: () => void;
  onOpenSettings: () => void;
}): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const insets = useSafeAreaInsets();

  return (
    <View
      className="flex-row items-center gap-2 border-border border-t bg-background px-4 pt-1"
      style={{ paddingBottom: Math.max(insets.bottom, 8) }}
    >
      <View className="h-2 w-2 rounded-full bg-success" />
      <Text className="min-w-0 flex-1 text-muted text-subhead" numberOfLines={1}>
        {hostName}
      </Text>
      <HeaderIconButton icon={PlusIcon} label={t('newThread')} onPress={onNewThread} />
      <HeaderIconButton icon={SettingsIcon} label={t('settings')} onPress={onOpenSettings} />
    </View>
  );
}
