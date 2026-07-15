import type { ContentBlock } from '@linkcode/schema';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslations } from 'use-intl';

import { blocksToText } from './format';

const CLAMP_LINES = 20;

export interface UserMessageProps {
  blocks: ContentBlock[];
  /** Long-press copy; the app owns clipboard + haptic feedback. */
  onCopyText?: (text: string) => void;
}

/**
 * Right-aligned bubble with a squared bottom-right corner (desktop's `rounded-2xl rounded-br`
 * corner-truncation tail). Long pastes clamp at 20 lines with a show-more toggle.
 */
export function UserMessage({ blocks, onCopyText }: UserMessageProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const [expanded, setExpanded] = useState(false);
  const text = blocksToText(blocks);
  const clamped = !expanded && text.split('\n').length > CLAMP_LINES;

  return (
    <View className="items-end pl-10">
      <Pressable
        accessibilityRole="text"
        onLongPress={onCopyText ? () => onCopyText(text) : undefined}
        className="rounded-2xl rounded-br-md border border-border bg-surface-secondary px-3.5 py-2.5"
      >
        <Text
          className="text-[15px] text-foreground"
          style={{ lineHeight: 21 }}
          numberOfLines={clamped ? CLAMP_LINES : undefined}
        >
          {text}
        </Text>
      </Pressable>
      {clamped ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded(true)}
          className="min-h-8 justify-center px-2"
        >
          <Text className="text-[12px] text-muted" style={{ fontWeight: '500' }}>
            {t('showMore')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
