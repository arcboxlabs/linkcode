import { Text, View } from 'react-native';

export interface MobileHomeProps {
  title: string;
  contract: string;
  registeredAgentsLabel: string;
  agentKinds: readonly string[];
  note: string;
}

/**
 * About/contract summary block. Owns no screen chrome (scrolling, insets) so it can
 * be embedded in any surrounding layout, e.g. a settings screen section.
 */
export function MobileHome({
  title,
  contract,
  registeredAgentsLabel,
  agentKinds,
  note,
}: MobileHomeProps): React.ReactNode {
  return (
    <View className="gap-2">
      <Text className="text-[20px] text-foreground" style={{ fontWeight: '600' }}>
        {title}
      </Text>
      <Text className="mb-4 text-[13px] text-muted">{contract}</Text>

      <Text
        className="mt-2 text-[11px] text-muted"
        style={{ fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' }}
      >
        {registeredAgentsLabel}
      </Text>
      {agentKinds.map((kind) => (
        <Text key={kind} className="text-[15px] text-foreground">
          • {kind}
        </Text>
      ))}

      <Text className="mt-6 text-[12px] text-accent" style={{ lineHeight: 20 }}>
        {note}
      </Text>
    </View>
  );
}
