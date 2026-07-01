import { ScrollView, Text, View } from 'react-native';

export interface MobileHomeProps {
  title: string;
  contract: string;
  registeredAgentsLabel: string;
  agentKinds: readonly string[];
  tunnel: string;
  statusBar?: React.ReactNode;
}

export function MobileHome({
  title,
  contract,
  registeredAgentsLabel,
  agentKinds,
  tunnel,
  statusBar,
}: MobileHomeProps): React.ReactNode {
  return (
    <View className="flex-1 bg-bg">
      {statusBar}
      <ScrollView className="flex-1">
        <View className="gap-2 p-6 pt-16">
          <Text className="text-[20px] text-text" style={{ fontWeight: '600' }}>
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
            <Text key={kind} className="text-[15px] text-text">
              • {kind}
            </Text>
          ))}

          <Text className="mt-6 text-[12px] text-accent" style={{ lineHeight: 20 }}>
            {tunnel}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
