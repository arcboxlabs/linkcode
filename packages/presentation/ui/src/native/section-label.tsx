import { Text } from 'react-native';

/** Uppercase section heading above a list group. */
export function SectionLabel({ children }: React.PropsWithChildren): React.ReactNode {
  return (
    <Text
      className="font-semibold text-caption text-muted uppercase"
      style={{ letterSpacing: 0.3 }}
    >
      {children}
    </Text>
  );
}
