import { Host, Spacer, VStack } from '@expo/ui/swift-ui';
import { frame, glassEffect } from '@expo/ui/swift-ui/modifiers';
import { SendButton } from '@mobile/components/conversation/send-button';
import { USES_IOS_26_NAVIGATION } from '@mobile/components/shell/ios-26-navigation';
import { useThemeColor } from 'heroui-native';
import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useTranslations } from 'use-intl';

/** Cap the growing input so a long draft scrolls internally instead of eating the screen. */
const MAX_INPUT_HEIGHT = 140;

/** Matches the card's `rounded-3xl`, so the glass shape and the RN clip agree. */
const CARD_RADIUS = 24;

const GLASS = [
  frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY }),
  glassEffect({
    glass: { variant: 'regular' },
    shape: 'roundedRectangle',
    cornerRadius: CARD_RADIUS,
  }),
];

/** The message composer card, shaped like the web composer: the editor on top and a footer row
 * below it — optional tool slots left and trailing, then the circular send/stop action. Chat
 * screens pass no tools; the new-thread draft fills the slots with its start-option chips.
 * Send and stop are wired by the screen; this owns nothing but the draft text. */
export function Composer({
  onSend,
  onStop,
  isRunning,
  disabled,
  error,
  sendBlocked = false,
  clearOnSend = true,
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
  /** Off for one-shot surfaces where a failed submit must not eat the draft. */
  clearOnSend?: boolean;
  /** Footer-left tool cluster (the draft's approval chip). */
  tools?: React.ReactNode;
  /** Footer-right cluster before send (the draft's harness/model/effort selector). */
  trailing?: React.ReactNode;
}): React.ReactNode {
  const t = useTranslations('mobile.conversation');
  const [text, setText] = useState('');
  const muted = useThemeColor('muted');

  const trimmed = text.trim();
  const canSend = !disabled && !sendBlocked && trimmed.length > 0;
  const actionEnabled = isRunning ? !disabled : canSend;

  const submit = (): void => {
    if (!canSend) return;
    onSend(trimmed);
    if (clearOnSend) setText('');
  };

  return (
    <View className={USES_IOS_26_NAVIGATION ? 'px-4 pt-2 pb-2' : 'bg-background px-4 pt-2 pb-2'}>
      {error ? <Text className="px-2 pb-1.5 text-danger text-footnote">{error}</Text> : null}
      {/* On iOS 26 the card's material is real Liquid Glass, drawn by a SwiftUI backdrop behind
          the RN input (the input itself must stay RN: multiline auto-grow + keyboard riding).
          Pre-26 and Android keep the filled card. */}
      <View
        className={
          USES_IOS_26_NAVIGATION
            ? 'rounded-3xl px-2 pt-1 pb-1.5'
            : 'rounded-3xl bg-surface-secondary px-2 pt-1 pb-1.5'
        }
      >
        {USES_IOS_26_NAVIGATION ? (
          <View className="absolute inset-0" pointerEvents="none">
            <Host style={{ flex: 1 }}>
              <VStack modifiers={GLASS}>
                <Spacer />
              </VStack>
            </Host>
          </View>
        ) : null}
        <TextInput
          className="min-h-[40px] px-2 py-2 text-body text-foreground"
          style={{ maxHeight: MAX_INPUT_HEIGHT }}
          placeholder={t('composerPlaceholder')}
          placeholderTextColor={muted}
          value={text}
          onChangeText={setText}
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
