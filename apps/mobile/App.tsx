import { AgentKindSchema, WIRE_PROTOCOL_VERSION } from '@linkcode/schema';
import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * Minimal mobile app: directly reuses the single source-of-truth data contract from @linkcode/schema,
 * proving the same set of zod types can be shared across platforms under Expo / Metro (PLAN §2.1 / §4.6).
 *
 * The UI component library is HeroUI (PLAN ✅). Its nativewind / tailwind / reanimated integration
 * needs to be verified on a simulator or real device; see HEROUI_SETUP.md for the steps, to be tackled next.
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
