import { diffLines } from '@linkcode/common/chat';
import { ScrollView, Text, View } from 'react-native';

import { DiffCounter } from './diff-counter';
import { MONO_FONT } from './mono';

export interface DiffBlockProps {
  path: string;
  oldText?: string;
  newText: string;
}

const ROW_CLASS = {
  add: 'bg-success/10',
  del: 'bg-danger/10',
  ctx: '',
} as const;

const GUTTER = { add: '+', del: '−', ctx: ' ' } as const;

/**
 * Per-file inline diff card (desktop `DiffBlock` grammar): bordered, mono, `+/−` gutter,
 * success/danger 10% washes. Wide lines scroll horizontally instead of wrapping.
 */
export function DiffBlock({ path, oldText, newText }: DiffBlockProps): React.ReactNode {
  const rows = diffLines(oldText ?? '', newText);
  const additions = rows.filter((row) => row.type === 'add').length;
  const deletions = rows.filter((row) => row.type === 'del').length;

  return (
    <View className="overflow-hidden rounded-lg border border-border">
      <View className="flex-row items-center gap-2 border-border border-b bg-surface-secondary px-3 py-1.5">
        <Text
          className="flex-1 text-[11px] text-foreground"
          style={{ fontFamily: MONO_FONT }}
          numberOfLines={1}
        >
          {path}
        </Text>
        <DiffCounter additions={additions} deletions={deletions} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="py-1">
          {rows.map((row) => (
            <View key={row.id} className={`flex-row px-2 ${ROW_CLASS[row.type]}`}>
              <Text
                className={`w-4 text-[11px] ${row.type === 'add' ? 'text-success' : row.type === 'del' ? 'text-danger' : 'text-muted'}`}
                style={{ fontFamily: MONO_FONT, lineHeight: 17 }}
                maxFontSizeMultiplier={1.2}
              >
                {GUTTER[row.type]}
              </Text>
              <Text
                className={`text-[11px] ${row.type === 'ctx' ? 'text-muted' : 'text-foreground'}`}
                style={{ fontFamily: MONO_FONT, lineHeight: 17 }}
                maxFontSizeMultiplier={1.2}
              >
                {row.text || ' '}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
