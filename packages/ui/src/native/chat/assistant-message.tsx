import type { ContentBlock } from '@linkcode/schema';
import type { MarkdownStyleMap } from '@ronradtke/react-native-markdown-display';
import Markdown from '@ronradtke/react-native-markdown-display';
import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useCSSVariable, useUniwind } from 'uniwind';

import { blocksToText } from './format';
import { MONO_FONT } from './mono';

export interface AssistantMessageProps {
  blocks: ContentBlock[];
  isStreaming: boolean;
  /** Long-press copy; the app owns clipboard + haptic feedback. */
  onCopyText?: (text: string) => void;
}

/**
 * Full-width markdown, no bubble (desktop parity). The style map reads HeroUI theme
 * variables through uniwind so it re-themes with the active color scheme.
 */
export function AssistantMessage({
  blocks,
  isStreaming,
  onCopyText,
}: AssistantMessageProps): React.ReactNode {
  const [foreground, muted, border, surfaceSecondary, link] = useCSSVariable([
    '--foreground',
    '--muted',
    '--border',
    '--surface-secondary',
    '--link',
  ]);

  const style = useMemo(
    (): MarkdownStyleMap => ({
      body: { color: String(foreground), fontSize: 15, lineHeight: 22 },
      paragraph: { marginTop: 0, marginBottom: 8 },
      heading1: { fontSize: 19, fontWeight: '600', marginTop: 12, marginBottom: 6 },
      heading2: { fontSize: 17, fontWeight: '600', marginTop: 10, marginBottom: 4 },
      heading3: { fontSize: 15, fontWeight: '600', marginTop: 8, marginBottom: 4 },
      link: { color: String(link) },
      blockquote: {
        backgroundColor: 'transparent',
        borderLeftWidth: 2,
        borderLeftColor: String(border),
        paddingLeft: 12,
        marginLeft: 0,
        opacity: 0.9,
      },
      code_inline: {
        backgroundColor: String(surfaceSecondary),
        color: String(foreground),
        borderRadius: 4,
        fontFamily: MONO_FONT,
        fontSize: 13,
      },
      code_block: {
        backgroundColor: String(surfaceSecondary),
        color: String(foreground),
        borderColor: String(border),
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
        fontFamily: MONO_FONT,
        fontSize: 12,
        lineHeight: 18,
      },
      fence: {
        backgroundColor: String(surfaceSecondary),
        color: String(foreground),
        borderColor: String(border),
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
        fontFamily: MONO_FONT,
        fontSize: 12,
        lineHeight: 18,
      },
      hr: { backgroundColor: String(border), height: 1 },
      bullet_list_icon: { color: String(muted) },
      ordered_list_icon: { color: String(muted) },
    }),
    [foreground, muted, border, surfaceSecondary, link],
  );

  const text = blocksToText(blocks);
  const { theme } = useUniwind();

  return (
    <Pressable
      accessibilityRole="text"
      onLongPress={onCopyText ? () => onCopyText(text) : undefined}
      className="w-full"
    >
      {/* colorScheme swaps the library's base style table; our overrides layer on top. */}
      <Markdown style={style} colorScheme={theme === 'dark' ? 'dark' : 'light'}>
        {text}
      </Markdown>
      {isStreaming ? <View className="h-4 w-2 rounded-[2px] bg-foreground opacity-70" /> : null}
    </Pressable>
  );
}
