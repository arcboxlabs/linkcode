import type { SessionStatus } from '@linkcode/schema';
import { useThemeColor } from 'heroui-native';
import { Text, View } from 'react-native';

/** Header title with the session's status as a dot — the same 8pt dot and palette as the thread
 * list rows, replacing the labeled chip. */
export function SessionTitle({
  title,
  status,
}: {
  title: string;
  status: SessionStatus | null;
}): React.ReactNode {
  const [success, warning, muted] = useThemeColor(['success', 'warning', 'muted']);
  const color =
    status === 'running'
      ? success
      : status === 'starting' || status === 'awaiting-input'
        ? warning
        : muted;

  return (
    <View className="flex-row items-center gap-1.5">
      {/* `headline` is the 17pt semibold metric UIKit draws inline nav titles with. */}
      <Text className="shrink font-semibold text-foreground text-headline" numberOfLines={1}>
        {title}
      </Text>
      {status ? <View className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} /> : null}
    </View>
  );
}
