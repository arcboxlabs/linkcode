import { Text, View } from 'react-native';

export interface EmptyStateProps {
  /** Leading pictogram slot (e.g. a lucide icon); the caller owns sizing and tint. */
  icon?: React.ReactNode;
  title: string;
  hint: string;
  /** Optional call-to-action rendered under the hint. */
  action?: React.ReactNode;
}

/** Centered placeholder for an empty list: pictogram, title, hint, optional CTA. */
export function EmptyState({ icon, title, hint, action }: EmptyStateProps): React.ReactNode {
  return (
    <View className="items-center gap-2 px-6 py-10">
      {icon ? <View className="mb-1 opacity-40">{icon}</View> : null}
      <Text className="text-center font-medium text-body text-foreground">{title}</Text>
      <Text className="max-w-[280px] text-center text-muted text-subhead">{hint}</Text>
      {action ? <View className="mt-3">{action}</View> : null}
    </View>
  );
}
