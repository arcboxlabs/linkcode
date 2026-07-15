import { ArrowUp, Square } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { useTranslations } from 'use-intl';

const MIN_INPUT_HEIGHT = 22;
const MAX_INPUT_HEIGHT = 132;

export interface ComposerProps {
  /** Controlled draft — the app owns it so a failed send can restore the text. */
  value: string;
  onChangeText: (text: string) => void;
  /** Already-translated placeholder ("Message Claude Code…"). */
  placeholder: string;
  /** A turn is in flight: the send button morphs to Stop. */
  running: boolean;
  /** Disables input + send entirely (e.g. while a stopped session resumes). */
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

/**
 * Bottom-pinned composer (design §4.5): auto-growing input, button-only send (IME
 * safety — Enter inserts a newline, CJK composition never submits), send⬆/stop■ morph.
 * The `rounded-2xl` frame is deliberately the softest element on screen.
 */
export function Composer({
  value,
  onChangeText,
  placeholder,
  running,
  disabled,
  onSend,
  onStop,
}: ComposerProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT);
  const [foreground, muted] = useCSSVariable(['--foreground', '--muted']);

  const canSend = !disabled && !running && value.trim().length > 0;

  const submit = (): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    setInputHeight(MIN_INPUT_HEIGHT);
    onSend(trimmed);
  };

  return (
    <View className="flex-row items-end gap-2 rounded-2xl border border-border bg-background py-2 pr-2 pl-3.5">
      <TextInput
        accessibilityLabel={placeholder}
        className="flex-1 text-[15px] text-foreground"
        style={{
          height: Math.min(Math.max(inputHeight, MIN_INPUT_HEIGHT), MAX_INPUT_HEIGHT) + 12,
          paddingTop: 6,
          paddingBottom: 6,
          textAlignVertical: 'center',
        }}
        multiline
        submitBehavior="newline"
        editable={!disabled}
        placeholder={placeholder}
        placeholderTextColor={String(muted)}
        value={value}
        onChangeText={onChangeText}
        onContentSizeChange={(event) => setInputHeight(event.nativeEvent.contentSize.height)}
      />
      {running ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('stop')}
          onPress={onStop}
          className="size-9 items-center justify-center rounded-full border-[1.5px] border-foreground"
        >
          <Square size={12} color={String(foreground)} fill={String(foreground)} />
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('send')}
          disabled={!canSend}
          onPress={submit}
          className={`size-9 items-center justify-center rounded-full ${
            canSend ? 'bg-foreground' : 'bg-muted/30'
          }`}
        >
          <ArrowUp size={17} color="white" />
        </Pressable>
      )}
    </View>
  );
}
