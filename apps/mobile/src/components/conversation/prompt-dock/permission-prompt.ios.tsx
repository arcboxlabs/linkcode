import { Button, Host, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  lineLimit,
  onTapGesture,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import type { PermissionPromptProps } from '@mobile/components/conversation/prompt-dock/permission-prompt.shared';
import {
  DANGER_KINDS,
  detailRows,
} from '@mobile/components/conversation/prompt-dock/permission-prompt.shared';
import { useNativePalette } from '@mobile/components/theme/native-palette';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const TERTIARY = foregroundStyle({ type: 'hierarchical', style: 'tertiary' });
const MONO_FOOTNOTE = font({ textStyle: 'footnote', design: 'monospaced' });
const WHOLE_ROW = contentShape(shapes.rectangle());

/**
 * Desktop `PermissionPrompt` grammar on SwiftUI: title + skip, mono detail rows, one tappable
 * row per option (deny options draw destructive red). The RN shell provides the card chrome so
 * it themes with the rest of the conversation surface.
 */
export function PermissionPrompt({
  toolCall,
  options,
  responding,
  onRespond,
}: PermissionPromptProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const palette = useNativePalette();

  return (
    <View
      className="rounded-xl border px-3 py-2.5"
      style={{ backgroundColor: palette.background, borderColor: palette.outline }}
    >
      <Host matchContents>
        <VStack alignment="leading" spacing={10}>
          <HStack spacing={8}>
            <Text
              modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), lineLimit(2)]}
            >
              {t('allowTitle', { title: toolCall.title ?? '' })}
            </Text>
            <Spacer />
            <Image
              systemName="xmark"
              size={13}
              modifiers={[
                TERTIARY,
                WHOLE_ROW,
                onTapGesture(() => {
                  if (!responding) onRespond({ outcome: 'cancelled' });
                }),
              ]}
            />
          </HStack>
          {detailRows(toolCall).map((row) => (
            <Text key={row.key} modifiers={[MONO_FOOTNOTE, SECONDARY, lineLimit(2)]}>
              {row.value}
            </Text>
          ))}
          <VStack alignment="leading" spacing={4}>
            {options.map((option) => (
              <Button
                key={option.optionId}
                label={option.name}
                role={DANGER_KINDS.has(option.kind) ? 'destructive' : undefined}
                onPress={() => onRespond({ outcome: 'selected', optionId: option.optionId })}
                modifiers={[buttonStyle('bordered'), disabled(responding)]}
              />
            ))}
          </VStack>
        </VStack>
      </Host>
    </View>
  );
}
