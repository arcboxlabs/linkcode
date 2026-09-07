import { SendButton } from '@mobile/components/conversation/send-button';
import { USES_IOS_26_NAVIGATION } from '@mobile/components/shell/ios-26-navigation';
import { useNativePalette } from '@mobile/components/theme/native-palette';
import { Text, TextInput, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { ComposerBackdrop } from './composer-backdrop';

/** Cap the growing input so a long draft scrolls internally instead of eating the screen. */
const MAX_INPUT_HEIGHT = 140;

/** The message composer card, shaped like the web composer: the editor on top and a footer row
 * below it — optional tool slots left and trailing, then the circular send/stop action. Chat
 * screens pass no tools; the new-thread draft fills the slots with its start-option chips.
 * Draft state and send/stop behavior belong to the screen's runtime hook. */
export function Composer({
  onSend,
  onStop,
  isRunning,
  disabled,
  error,
  sendBlocked = false,
  text,
  onTextChange,
  tools,
  trailing,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  isRunning: boolean;
  disabled: boolean;
  error?: string;
  /** Typing stays possible while send is off (e.g. no working directory resolved yet). */
  sendBlocked?: boolean;
  text: string;
  onTextChange: (text: string) => void;
  /** Footer-left tool cluster (the draft's approval chip). */
  tools?: React.ReactNode;
  /** Footer-right cluster before send (the draft's harness/model/effort selector). */
  trailing?: React.ReactNode;
}): React.ReactNode {
  const t = useTranslations('mobile.conversation');
  const palette = useNativePalette();

  const trimmed = text.trim();
  const canSend = !disabled && !sendBlocked && trimmed.length > 0;
  const actionEnabled = isRunning ? !disabled : canSend;

  const submit = (): void => {
    if (!canSend) return;
    onSend(trimmed);
  };

  return (
    <View
      className="px-4 pt-2 pb-2"
      style={USES_IOS_26_NAVIGATION ? undefined : { backgroundColor: palette.background }}
    >
      {error ? (
        <Text
          selectable
          accessibilityRole="alert"
          className="px-2 pb-1.5 text-footnote"
          style={{ color: palette.danger }}
        >
          {error}
        </Text>
      ) : null}
      {/* On iOS 26 the card's material is real Liquid Glass, drawn by a SwiftUI backdrop behind
          the RN input (the input itself must stay RN: multiline auto-grow + keyboard riding).
          Pre-26 and Android keep the filled card. */}
      <View
        className="rounded-3xl px-2 pt-1 pb-1.5"
        style={USES_IOS_26_NAVIGATION ? undefined : { backgroundColor: palette.surface }}
      >
        <ComposerBackdrop />
        <TextInput
          className="min-h-[40px] px-2 py-2 text-body"
          style={{ maxHeight: MAX_INPUT_HEIGHT, color: palette.text }}
          placeholder={t('composerPlaceholder')}
          placeholderTextColor={palette.textSecondary}
          value={text}
          onChangeText={onTextChange}
          editable={!disabled}
          multiline
        />
        <View className="flex-row items-center gap-1.5 pl-1">
          {tools}
          <View className="flex-1" />
          {trailing}
          <SendButton
            isRunning={isRunning}
            enabled={actionEnabled}
            sendLabel={t('send')}
            stopLabel={t('stop')}
            onSend={submit}
            onStop={onStop}
          />
        </View>
      </View>
    </View>
  );
}
