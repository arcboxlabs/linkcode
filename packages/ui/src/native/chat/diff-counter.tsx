import { Text, View } from 'react-native';

import { MONO_FONT } from './mono';

export interface DiffCounterProps {
  additions: number;
  deletions: number;
}

/** The `+N −N` mono chip shared by tool rows, sheet headers, and diff-card headers. */
export function DiffCounter({ additions, deletions }: DiffCounterProps): React.ReactNode {
  if (additions === 0 && deletions === 0) return null;
  return (
    <View className="flex-row items-center gap-1">
      {additions > 0 ? (
        <Text className="text-[11px] text-success" style={{ fontFamily: MONO_FONT }}>
          +{additions}
        </Text>
      ) : null}
      {deletions > 0 ? (
        <Text className="text-[11px] text-danger" style={{ fontFamily: MONO_FONT }}>
          −{deletions}
        </Text>
      ) : null}
    </View>
  );
}
