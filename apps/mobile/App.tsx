import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View } from 'react-native';
import './global.css';

/**
 * Minimal mobile app, styled with NativeWind (Tailwind for React Native).
 * Reuses the single source-of-truth data contract from @linkcode/schema, proving the same
 * zod types are shared across platforms under Expo / Metro (PLAN §2.1 / §4.6).
 *
 * The HeroUI component library (PLAN ✅) builds on NativeWind; its remaining setup is in HEROUI_SETUP.md.
 */
export default function App() {
  return (
    <View className="flex-1 bg-bg">
      <StatusBar style="light" />
      <ScrollView className="flex-1">
        <View className="gap-2 p-6 pt-16">
          <Text className="text-xl font-semibold text-text">Link Code · Mobile</Text>
          <Text className="mb-4 text-[13px] text-muted">
            共享数据契约 · wire v{WIRE_PROTOCOL_VERSION} · 来自 @linkcode/schema
          </Text>

          <Text className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            已登记的 agent 适配
          </Text>
          {AgentKindSchema.options.map((kind) => (
            <Text key={kind} className="text-[15px] text-text">
              • {kind}
            </Text>
          ))}

          <Text className="mt-6 text-[12px] leading-5 text-accent">
            数据面将经 Server tunnel（websocket）远程接入本地 Host。{'\n'}
            UI 库 HeroUI 的接入步骤见 HEROUI_SETUP.md（NativeWind 已接入）。
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
