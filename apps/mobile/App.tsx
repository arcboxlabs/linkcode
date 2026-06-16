import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * Mobile 最小应用：直接复用 @linkcode/schema 的唯一数据契约，
 * 证明同一套 zod 类型在 Expo / Metro 下可跨端共享（PLAN §2.1 / §4.6）。
 *
 * UI 组件库为 HeroUI（PLAN ✅）。其 nativewind / tailwind / reanimated 接入需在
 * 模拟器或真机上验证，步骤见 HEROUI_SETUP.md，作为下一步落地。
 */
export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Link Code · Mobile</Text>
        <Text style={styles.subtitle}>
          共享数据契约 · wire v{WIRE_PROTOCOL_VERSION} · 来自 @linkcode/schema
        </Text>

        <Text style={styles.section}>已登记的 agent 适配</Text>
        {AgentKindSchema.options.map((kind) => (
          <Text key={kind} style={styles.item}>
            • {kind}
          </Text>
        ))}

        <Text style={styles.note}>
          数据面将经 Server tunnel（websocket）远程接入本地 Host。{'\n'}
          UI 库 HeroUI 的接入步骤见 HEROUI_SETUP.md。
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0e0f12' },
  content: { padding: 24, paddingTop: 72, gap: 8 },
  title: { color: '#e6e8ec', fontSize: 20, fontWeight: '600' },
  subtitle: { color: '#9aa1ad', fontSize: 13, marginBottom: 16 },
  section: {
    color: '#9aa1ad',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  item: { color: '#e6e8ec', fontSize: 15, fontFamily: 'monospace' },
  note: { color: '#6ea8fe', fontSize: 12, marginTop: 24, lineHeight: 18 },
});
