import { Column, Host, OutlinedButton, Text, useMaterialColors } from '@expo/ui/jetpack-compose';
import { fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import type { PermissionPromptProps } from '@mobile/components/conversation/prompt-dock/permission-prompt.shared';
import {
  DANGER_KINDS,
  detailRows,
} from '@mobile/components/conversation/prompt-dock/permission-prompt.shared';
import { useThemeColor } from 'heroui-native';
import { XIcon } from 'lucide-react-native';
import { Pressable, Text as RNText, View } from 'react-native';
import { useTranslations } from 'use-intl';

/**
 * Android permission prompt: the same grammar as the SwiftUI card — title + skip, mono detail
 * rows — with the option rows as MD3 outlined buttons (deny options in the error color). The RN
 * shell provides the card chrome so it themes with the rest of the conversation surface.
 */
export function PermissionPrompt({
  toolCall,
  options,
  responding,
  onRespond,
}: PermissionPromptProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const colors = useMaterialColors();
  const muted = useThemeColor('muted');

  return (
    <View className="gap-2.5 rounded-xl border border-border bg-background px-3 py-2.5">
      <View className="flex-row items-center gap-2">
        <RNText className="flex-1 font-semibold text-foreground text-subhead" numberOfLines={2}>
          {t('allowTitle', { title: toolCall.title ?? '' })}
        </RNText>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          disabled={responding}
          onPress={() => onRespond({ outcome: 'cancelled' })}
        >
          <XIcon size={14} color={muted} />
        </Pressable>
      </View>
      {detailRows(toolCall).map((row) => (
        <RNText
          key={row.key}
          className="text-footnote text-muted"
          style={{ fontFamily: 'monospace' }}
          numberOfLines={2}
        >
          {row.value}
        </RNText>
      ))}
      <Host matchContents>
        <Column verticalArrangement={{ spacedBy: 4 }} modifiers={[fillMaxWidth()]}>
          {options.map((option) => (
            <OutlinedButton
              key={option.optionId}
              enabled={!responding}
              colors={DANGER_KINDS.has(option.kind) ? { contentColor: colors.error } : undefined}
              onClick={() => onRespond({ outcome: 'selected', optionId: option.optionId })}
              modifiers={[fillMaxWidth()]}
            >
              <Text>{option.name}</Text>
            </OutlinedButton>
          ))}
        </Column>
      </Host>
    </View>
  );
}
