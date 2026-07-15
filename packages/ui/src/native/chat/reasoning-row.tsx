import type { ContentBlock } from '@linkcode/schema';
import { Brain, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { useTranslations } from 'use-intl';

import { blocksToText } from './format';
import { PulsingText } from './pulsing-text';

export interface ReasoningRowProps {
  blocks: ContentBlock[];
  isStreaming: boolean;
}

/**
 * Collapsed thinking row (brain glyph + preview); forced open while streaming, the user's
 * toggle takes over after. Expanded body is the desktop treatment: left rule + italic.
 */
export function ReasoningRow({ blocks, isStreaming }: ReasoningRowProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const [open, setOpen] = useState<boolean | null>(null);
  const mutedColor = String(useCSSVariable('--muted'));
  const text = blocksToText(blocks);
  const expanded = open ?? isStreaming;

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('thought')}
        onPress={() => setOpen(!expanded)}
        className="min-h-9 flex-row items-center gap-2 py-1"
      >
        <Brain size={15} color={mutedColor} />
        {isStreaming ? (
          <PulsingText className="text-[13px] text-muted" weight="500">
            {t('thought')}
          </PulsingText>
        ) : (
          <Text className="text-[13px] text-muted" style={{ fontWeight: '500' }}>
            {t('thought')}
          </Text>
        )}
        {!expanded && text ? (
          <Text className="flex-1 text-[12px] text-muted" numberOfLines={1}>
            {text}
          </Text>
        ) : null}
        <ChevronRight
          size={14}
          color={mutedColor}
          style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
        />
      </Pressable>
      {expanded && text ? (
        <View className="border-border border-l-2 pl-3">
          <Text
            className="text-[13px] text-muted"
            style={{ fontStyle: 'italic', lineHeight: 19, opacity: 0.9 }}
          >
            {text}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
