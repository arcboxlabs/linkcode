import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { MobileHome } from '@linkcode/ui/native';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, View } from 'react-native';
import { useTranslations } from 'use-intl';

export default function HomeScreen() {
  const t = useTranslations('mobile.about');

  return (
    <View className="flex-1 bg-background">
      <StatusBar style="auto" />
      <ScrollView className="flex-1">
        <View className="p-6 pt-16">
          <MobileHome
            title={t('title')}
            contract={t('contract', { version: WIRE_PROTOCOL_VERSION })}
            registeredAgentsLabel={t('registeredAgents')}
            agentKinds={AgentKindSchema.options}
            note={t('note')}
          />
        </View>
      </ScrollView>
    </View>
  );
}
