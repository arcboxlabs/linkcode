import { Composer } from '@mobile/components/conversation/composer';
import { AgentSelectorChip, ApprovalChip } from '@mobile/components/host/new-thread/draft-tools';
import { ProjectRow } from '@mobile/components/host/new-thread/project-row';
import { useNewThreadDraft } from '@mobile/runtime/use-new-thread-draft';
import { useRouter } from 'expo-router';
import { noop } from 'foxact/noop';
import { View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';

export function NewThreadScreen(): React.ReactNode {
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
