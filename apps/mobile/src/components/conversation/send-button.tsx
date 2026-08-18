import { useNativePalette } from '@mobile/components/theme/native-palette';
import { ArrowUpIcon, SquareIcon } from 'lucide-react-native';
import { Pressable } from 'react-native';

/** The round send action shared by the conversation composer and the new-thread draft: one
 * circular button that morphs between send and stop, because a turn in flight is the only thing
 * the user wants to do to it. Filled with the platform tint, like the native senders. */
export function SendButton({
  isRunning,
  enabled,
  sendLabel,
  stopLabel,
  onSend,
  onStop,
}: {
  isRunning: boolean;
  enabled: boolean;
  sendLabel: string;
  stopLabel: string;
  onSend: () => void;
  onStop: () => void;
}): React.ReactNode {
  const palette = useNativePalette();
  const ActionIcon = isRunning ? SquareIcon : ArrowUpIcon;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isRunning ? stopLabel : sendLabel}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={isRunning ? onStop : onSend}
      className="h-9 w-9 items-center justify-center rounded-full"
      style={({ pressed }) => ({
        backgroundColor: enabled ? palette.tint : palette.outline,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <ActionIcon
        size={17}
        color={palette.onTint}
        fill={isRunning ? palette.onTint : 'transparent'}
        strokeWidth={2.5}
      />
    </Pressable>
  );
}
