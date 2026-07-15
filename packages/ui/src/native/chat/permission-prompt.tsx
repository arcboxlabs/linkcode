import type { PermissionOption, PermissionOutcome, ToolCallUpdate } from '@linkcode/schema';
import { Spinner } from 'heroui-native';
import { X } from 'lucide-react-native';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { useTranslations } from 'use-intl';

import { MONO_FONT } from './mono';

export interface PermissionPromptProps {
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
  /** In-flight option (disables the card, spinner on that row). */
  respondingOptionId?: string;
  onRespond: (outcome: PermissionOutcome) => void;
}

interface DetailRow {
  key: string;
  value: string;
}

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
    if (typeof record.command === 'string') rows.push({ key: 'command', value: record.command });
    if (typeof record.url === 'string') rows.push({ key: 'url', value: record.url });
  }
  return rows;
}

const DANGER_KINDS = new Set(['reject_once', 'reject_always']);

/**
 * Desktop `PermissionPrompt` grammar: title + kind badge, mono detail rows, numbered
 * single-tap choice rows (deny rows tint danger), skip = `{ outcome: 'cancelled' }`.
 * For unrecognized (`other`) tools the raw input JSON is shown — the user's one chance
 * to see what they're approving.
 */
export function PermissionPrompt({
  toolCall,
  options,
  respondingOptionId,
  onRespond,
}: PermissionPromptProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const mutedColor = String(useCSSVariable('--muted'));
  const rows = detailRows(toolCall);
  const busy = respondingOptionId !== undefined;
  const showRawArguments =
    (toolCall.kind === 'other' || toolCall.kind === undefined) &&
    rows.length === 0 &&
    toolCall.rawInput !== undefined;

  return (
    <View className="rounded-xl border border-border bg-background">
      <View className="flex-row items-center gap-2 px-3.5 pt-3 pb-1">
        <Text className="flex-1 text-[14px] text-foreground" style={{ fontWeight: '600' }}>
          {t('allowTitle', { title: toolCall.title ?? '' })}
        </Text>
        {toolCall.kind ? (
          <View className="rounded-md bg-surface-secondary px-2 py-0.5">
            <Text
              className="text-[10px] text-muted"
              style={{ fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' }}
            >
              {toolCall.kind}
            </Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('skip')}
          disabled={busy}
          onPress={() => onRespond({ outcome: 'cancelled' })}
          className="size-8 items-center justify-center"
        >
          <X size={15} color={mutedColor} />
        </Pressable>
      </View>
      {rows.map((row) => (
        <Text
          key={row.key}
          className="px-3.5 pb-1 text-[11px] text-muted"
          style={{ fontFamily: MONO_FONT }}
          numberOfLines={2}
        >
          {row.value}
        </Text>
      ))}
      {showRawArguments ? (
        <View className="mx-3.5 mb-1 max-h-40 overflow-hidden rounded-lg bg-surface-secondary">
          <ScrollView>
            <Text className="p-2 text-[10.5px] text-muted" style={{ fontFamily: MONO_FONT }}>
              {JSON.stringify(toolCall.rawInput, null, 2)}
            </Text>
          </ScrollView>
        </View>
      ) : null}
      <View className="mt-1">
        {options.map((option, index) => {
          const danger = DANGER_KINDS.has(option.kind);
          const responding = respondingOptionId === option.optionId;
          return (
            <Pressable
              key={option.optionId}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => onRespond({ outcome: 'selected', optionId: option.optionId })}
              className="min-h-11 flex-row items-center gap-2.5 border-border border-t px-3.5"
            >
              <View
                className={`size-5 items-center justify-center rounded-full border ${
                  danger ? 'border-danger/60' : 'border-border'
                }`}
              >
                <Text
                  className={`text-[10.5px] ${danger ? 'text-danger' : 'text-foreground'}`}
                  style={{ fontWeight: '600' }}
                >
                  {index + 1}
                </Text>
              </View>
              <Text
                className={`flex-1 text-[13px] ${danger ? 'text-danger' : 'text-foreground'}`}
                style={{ fontWeight: '500' }}
              >
                {option.name}
              </Text>
              {responding ? <Spinner size="sm" color="default" /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
