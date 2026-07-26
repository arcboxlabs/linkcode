import { useThemeColor } from 'heroui-native';
import { ArrowUpIcon, SquareIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslations } from 'use-intl';

/** Cap the growing input so a long draft scrolls internally instead of eating the timeline. */
const MAX_INPUT_HEIGHT = 140;

/** Message composer pinned below the timeline. One circular action morphs between send and
 * stop, because a turn in flight is the only thing the user wants to do to it. Send and stop are
 * wired by the screen; this owns nothing but the draft. */
export function Composer({
  onSend,
  onStop,
  isRunning,
  disabled,
  error,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  isRunning: boolean;
  disabled: boolean;
  error?: string;
}): React.ReactNode {
  const t = useTranslations('mobile.conversation');
  const [text, setText] = useState('');
  const [muted, background, foreground] = useThemeColor(['muted', 'background', 'foreground']);

  const trimmed = text.trim();
  const canSend = !disabled && trimmed.length > 0;
  const actionEnabled = isRunning ? !disabled : canSend;

  const submit = (): void => {
    if (!canSend) return;
    onSend(trimmed);
    setText('');
  };

  const ActionIcon = isRunning ? SquareIcon : ArrowUpIcon;

  return (
    <View className="bg-background px-4 pt-2 pb-2">
      {error ? <Text className="px-2 pb-1.5 text-danger text-footnote">{error}</Text> : null}
      <View className="flex-row items-end gap-2 rounded-3xl bg-surface-secondary py-1.5 pr-1.5 pl-4">
        <TextInput
          className="min-h-[36px] flex-1 py-2 text-body text-foreground"
          style={{ maxHeight: MAX_INPUT_HEIGHT }}
          placeholder={t('composerPlaceholder')}
          placeholderTextColor={muted}
          value={text}
          onChangeText={setText}
          editable={!disabled}
          multiline
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRunning ? t('stop') : t('send')}
          accessibilityState={{ disabled: !actionEnabled }}
          disabled={!actionEnabled}
          onPress={isRunning ? onStop : submit}
          className="h-9 w-9 items-center justify-center rounded-full"
          style={({ pressed }) => ({
            backgroundColor: actionEnabled ? foreground : muted,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <ActionIcon
            size={17}
            color={background}
            fill={isRunning ? background : 'transparent'}
            strokeWidth={2.5}
          />
        </Pressable>
      </View>
    </View>
  );
}
