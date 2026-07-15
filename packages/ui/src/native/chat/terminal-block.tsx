import { stripAnsi } from '@linkcode/common/chat';
import { Terminal } from 'lucide-react-native';
import { ScrollView, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { MONO_FONT } from './mono';

export interface TerminalBlockProps {
  /** The command line, shown in the card header. */
  command?: string;
  output: string;
}

/**
 * Read-only command-output card. M1 strips ANSI escapes and renders plain mono
 * (design §4.3); SGR color mapping is the M2 follow-up.
 */
export function TerminalBlock({ command, output }: TerminalBlockProps): React.ReactNode {
  const mutedColor = String(useCSSVariable('--muted'));

  return (
    <View className="overflow-hidden rounded-lg border border-border">
      {command ? (
        <View className="flex-row items-center gap-2 border-border border-b bg-surface-secondary px-3 py-1.5">
          <Terminal size={13} color={mutedColor} />
          <Text
            className="flex-1 text-[11px] text-foreground"
            style={{ fontFamily: MONO_FONT }}
            numberOfLines={1}
          >
            {command}
          </Text>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text
          className="px-3 py-2 text-[11px] text-foreground"
          style={{ fontFamily: MONO_FONT, lineHeight: 17 }}
          maxFontSizeMultiplier={1.2}
        >
          {stripAnsi(output)}
        </Text>
      </ScrollView>
    </View>
  );
}
