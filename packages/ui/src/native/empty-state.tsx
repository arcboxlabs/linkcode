import { Text, View } from 'react-native';

export interface EmptyStateProps {
  title: string;
  hint: string;
}

/** Two-line placeholder for an empty list: a title and a hint. */
export function EmptyState({ title, hint }: EmptyStateProps): React.ReactNode {
  return (
    <View className="gap-1">
      <Text className="text-[15px] text-foreground" style={{ fontWeight: '500' }}>
        {title}
      </Text>
      <Text className="text-[13px] text-muted" style={{ lineHeight: 18 }}>
        {hint}
      </Text>
    </View>
  );
}
