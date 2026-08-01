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
import type { PermissionOption, PermissionOutcome, ToolCallUpdate } from '@linkcode/schema';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const TERTIARY = foregroundStyle({ type: 'hierarchical', style: 'tertiary' });
const MONO_FOOTNOTE = font({ textStyle: 'footnote', design: 'monospaced' });
const WHOLE_ROW = contentShape(shapes.rectangle());

const DANGER_KINDS = new Set(['reject_once', 'reject_always']);

interface DetailRow {
  key: string;
  value: string;
}

/** The most identifying facts of the pending call: touched paths, then command/url inputs.
 * Raw input JSON is deliberately not dumped — an unrecognized tool still shows its scalar
 * fields through `locations`/`content`, and the model keeps the rest. */
function detailRows(toolCall: ToolCallUpdate): DetailRow[] {
  const rows: DetailRow[] = [];
  for (const location of toolCall.locations ?? []) {
    rows.push({ key: `loc:${location.path}`, value: location.path });
  }
  for (const content of toolCall.content ?? []) {
    if (content.type === 'diff' && !rows.some((row) => row.value === content.path)) {
      rows.push({ key: `diff:${content.path}`, value: content.path });
    }
  }
  const input = toolCall.rawInput;
  if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    for (const key of ['file_path', 'path', 'notebook_path', 'filePath']) {
      const value = record[key];
      if (typeof value === 'string' && !rows.some((row) => row.value === value)) {
        rows.push({ key: `path:${key}`, value });
        break;
      }
    }
    if (typeof record.command === 'string') rows.push({ key: 'command', value: record.command });
    if (typeof record.url === 'string') rows.push({ key: 'url', value: record.url });
  }
  return rows;
}

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
}: {
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  responding: boolean;
  onRespond: (outcome: PermissionOutcome) => void;
}): React.ReactNode {
  const t = useTranslations('mobile.chat');

  return (
    <View className="rounded-xl border border-border bg-background px-3 py-2.5">
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
