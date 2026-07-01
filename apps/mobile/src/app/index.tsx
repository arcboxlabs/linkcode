import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { MobileHome } from '@linkcode/ui/native';
import { StatusBar } from 'expo-status-bar';
import { useTranslations } from 'use-intl';

export default function HomeScreen() {
  const t = useTranslations('mobile');

  return (
    <MobileHome
      title={t('title')}
      contract={t('contract', { version: WIRE_PROTOCOL_VERSION })}
      registeredAgentsLabel={t('registeredAgents')}
      agentKinds={AgentKindSchema.options}
      tunnel={t('tunnel')}
      statusBar={<StatusBar style="light" />}
    />
  );
}
