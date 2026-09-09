import { Composer } from '@mobile/components/conversation/composer';
import { HostClientGate } from '@mobile/components/host/host-client-gate';
import { AgentSelectorChip, ApprovalChip } from '@mobile/components/host/new-thread/draft-tools';
import { ProjectRow } from '@mobile/components/host/new-thread/project-row';
import { VISIBLE_HEADER_OPTIONS } from '@mobile/components/shell/use-stack-screen-options';
import { useNewThreadDraft } from '@mobile/runtime/use-new-thread-draft';
import { Stack, useRouter } from 'expo-router';
import { noop } from 'foxact/noop';
import { View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Composer-first new-thread page, the mobile shape of the desktop draft surface: the start
 * options live inside the composer as menu chips — type the first message, send, and the thread
 * starts on the host with the prompt riding behind it. A root push, so it covers the tab bar. */
export default function NewThreadRoute(): React.ReactNode {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-background" style={{ paddingBottom: insets.bottom }}>
      {/* Title-less on purpose: the composer says everything, and the bare back chevron keeps
          the page reading as a sheet of options rather than a destination. */}
      <Stack.Screen options={{ ...VISIBLE_HEADER_OPTIONS, title: '' }} />
      <HostClientGate>
        <NewThreadScreen />
      </HostClientGate>
    </View>
  );
}

function NewThreadScreen(): React.ReactNode {
  const router = useRouter();
  const { text, setText, start, creating, sendBlocked, error, project, approval, selector } =
    useNewThreadDraft((sessionId) => router.replace(`/session/${sessionId}`));

  return (
    <>
      <View className="flex-1" />
      <KeyboardStickyView>
        <ProjectRow {...project} />
        <Composer
          text={text}
          onTextChange={setText}
          onSend={(text) => {
            void start(text);
          }}
          onStop={noop}
          isRunning={false}
          disabled={creating}
          sendBlocked={sendBlocked}
          error={error}
          tools={<ApprovalChip {...approval} />}
          trailing={<AgentSelectorChip {...selector} />}
        />
      </KeyboardStickyView>
    </>
  );
}
