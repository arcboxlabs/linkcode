import { FilledTonalButton, FlowRow, Text, TextButton } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import type { PermissionPromptProps } from '@mobile/components/conversation/prompt-dock/permission-prompt.shared';
import {
  DANGER_KINDS,
  detailRows,
} from '@mobile/components/conversation/prompt-dock/permission-prompt.shared';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { NativeIconButton } from '@mobile/components/form/icon-button';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import { Text as RNText, ScrollView, View } from 'react-native';
import { useTranslations } from 'use-intl';

export function PermissionPrompt({
  toolCall,
  options,
  responding,
  onRespond,
}: PermissionPromptProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const colors = useAppMaterialColors();

  return (
    <View
      className="gap-1 rounded-2xl px-3 py-2"
      style={{ backgroundColor: colors.surfaceContainer }}
    >
      <View className="flex-row items-center gap-2">
        <RNText
          className="flex-1 font-semibold text-subhead"
          style={{ color: colors.onSurface }}
          numberOfLines={2}
        >
          {t('allowTitle', { title: toolCall.title ?? '' })}
        </RNText>
        <NativeIconButton
          icon="close"
          label={t('skip')}
          disabled={responding}
          onPress={() => onRespond({ outcome: 'cancelled' })}
        />
      </View>
      <ScrollView style={{ maxHeight: 96 }} nestedScrollEnabled>
        {detailRows(toolCall).map((row) => (
          <RNText
            selectable
            key={row.key}
            className="text-footnote"
            style={{ fontFamily: 'monospace', color: colors.onSurfaceVariant }}
          >
            {row.value}
          </RNText>
        ))}
      </ScrollView>
      <ThemedHost matchContents={{ vertical: true }}>
        <FlowRow horizontalArrangement={{ spacedBy: 4 }} modifiers={[fillMaxWidth()]}>
          {options.map((option) => {
            const Action = option.kind === 'allow_once' ? FilledTonalButton : TextButton;
            return (
              <Action
                key={option.optionId}
                enabled={!responding}
                colors={DANGER_KINDS.has(option.kind) ? { contentColor: colors.error } : undefined}
                onClick={() => onRespond({ outcome: 'selected', optionId: option.optionId })}
                contentPadding={{ start: 12, end: 12 }}
              >
                <Text>{option.name}</Text>
              </Action>
            );
          })}
        </FlowRow>
      </ThemedHost>
    </View>
  );
}
