import { TerminalIdSchema } from '@linkcode/schema';
import TerminalRenderer from '@mobile/components/terminal-renderer';
import { useTerminalSession } from '@mobile/runtime/use-terminal-session';
import { resolveTerminalTheme, useTerminalPrefsStore } from '@mobile/stores/terminal-prefs-store';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button, Chip, Spinner } from 'heroui-native';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

/** Interactive mobile view of one host-owned PTY. Attachment and all network I/O live in
 * {@link useTerminalSession}; this route only renders and navigates. */
export default function TerminalScreen(): React.ReactNode {
  const t = useTranslations('mobile.terminal');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ terminalId: string; takeover?: string }>();
  const parsed = TerminalIdSchema.safeParse(params.terminalId);
  const terminalId = parsed.success ? parsed.data : null;
  const fontSize = useTerminalPrefsStore((state) => state.fontSize);
  const theme = resolveTerminalTheme(useTerminalPrefsStore((state) => state.colorScheme));
  const {
    setRenderer,
    status,
    terminal,
    canControl,
    takingControl,
    truncated,
    error: attachError,
    exit,
    onInput,
    onResize,
    onRendererReady,
    onRendererError,
    takeControl,
    close,
    retry,
  } = useTerminalSession(terminalId, params.takeover === '1');

  // Only this route knows the id came from an unparseable route param.
  const error = attachError ?? (terminalId === null ? t('invalidId') : null);
  const detach = () => {
    router.back();
  };

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="flex-row items-center gap-2 px-3 py-2">
        <Button variant="ghost" size="sm" onPress={detach}>
          <Button.Label>{t('detach')}</Button.Label>
        </Button>
        <View className="min-w-0 flex-1">
          <Text className="text-body text-foreground" numberOfLines={1}>
            {terminal?.cwd ?? t('title')}
          </Text>
        </View>
        {status === 'ready' ? (
          <Chip variant="soft" size="sm" color={canControl ? 'success' : 'warning'}>
            <Chip.Label>{canControl ? t('controlling') : t('readOnly')}</Chip.Label>
          </Chip>
        ) : null}
      </View>

      {truncated ? (
        <Text className="bg-warning/10 px-4 py-2 text-footnote text-warning">{t('truncated')}</Text>
      ) : null}
      {error ? (
        <Text className="bg-danger/10 px-4 py-2 text-danger text-footnote">
          {t('error', { error })}
        </Text>
      ) : null}
      {exit ? (
        <Text className="bg-default/10 px-4 py-2 text-footnote text-muted">
          {exit.code === null ? t('exitedSignal') : t('exited', { code: exit.code })}
        </Text>
      ) : null}

      {status === 'attaching' ? (
        <View className="flex-1 items-center justify-center gap-3">
          <Spinner />
          <Text className="text-muted text-subhead">{t('attaching')}</Text>
        </View>
      ) : status === 'error' ? (
        <View className="flex-1 items-center justify-center">
          <Button onPress={terminalId ? retry : detach}>
            <Button.Label>{terminalId ? t('retry') : t('detach')}</Button.Label>
          </Button>
        </View>
      ) : (
        <TerminalRenderer
          ref={setRenderer}
          canControl={canControl && exit === null}
          fontSize={fontSize}
          theme={theme}
          onInput={onInput}
          onResize={onResize}
          onReady={onRendererReady}
          onError={onRendererError}
        />
      )}

      {status === 'ready' && exit === null ? (
        <View className="flex-row gap-2 px-3 py-2">
          {canControl ? (
            <Button className="flex-1" variant="danger-soft" onPress={close}>
              <Button.Label>{t('close')}</Button.Label>
            </Button>
          ) : terminal?.managed ? (
            <Text className="flex-1 py-2 text-center text-muted text-subhead">
              {t('managedReadOnly')}
            </Text>
          ) : (
            <Button className="flex-1" onPress={takeControl} isDisabled={takingControl}>
              <Button.Label>{takingControl ? t('takingControl') : t('takeControl')}</Button.Label>
            </Button>
          )}
        </View>
      ) : null}
    </View>
  );
}
