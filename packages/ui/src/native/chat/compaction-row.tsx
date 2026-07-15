import { FoldVertical } from 'lucide-react-native';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { useTranslations } from 'use-intl';

import { formatTokens } from './format';

export interface CompactionRowProps {
  preTokens?: number;
  postTokens?: number;
}

/** Mid-conversation "cut point" divider: glyph + label + token detail + a rule filling the row. */
export function CompactionRow({ preTokens, postTokens }: CompactionRowProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const mutedColor = String(useCSSVariable('--muted'));

  return (
    <View className="flex-row items-center gap-2 py-1">
      <FoldVertical size={13} color={mutedColor} />
      <Text className="text-[12px] text-muted" style={{ fontWeight: '500' }}>
        {t('compacted')}
      </Text>
      {preTokens !== undefined && postTokens !== undefined ? (
        <Text className="text-[12px] text-muted">
          {t('compactedTokens', { pre: formatTokens(preTokens), post: formatTokens(postTokens) })}
        </Text>
      ) : null}
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}
