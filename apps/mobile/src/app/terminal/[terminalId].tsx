import { TerminalIdSchema } from '@linkcode/schema';
import { ActionButton } from '@mobile/components/form/action-button';
import { HostClientGate } from '@mobile/components/host/host-client-gate';
import TerminalRenderer from '@mobile/components/terminal/terminal-renderer';
import { useNativePalette } from '@mobile/components/theme/native-palette';
import { useTerminalSession } from '@mobile/runtime/use-terminal-session';
import { resolveTerminalTheme, useTerminalPrefsStore } from '@mobile/stores/terminal-prefs-store';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

/** A terminal is a screen of the host stack, not of a tab, so the canvas owns the full height. */
export default function TerminalRoute(): React.ReactNode {
  return (
    <HostClientGate>
      <TerminalScreen />
    </HostClientGate>
  );
}

/** Interactive mobile view of one host-owned PTY. Attachment and all network I/O live in
 * {@link useTerminalSession}; this route only renders and navigates. */
function TerminalScreen(): React.ReactNode {
  const t = useTranslations('mobile.terminal');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const palette = useNativePalette();
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
      className="flex-1"
      style={{
        backgroundColor: palette.background,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      <View className="flex-row items-center gap-2 px-3 py-2">
        <ActionButton variant="text" onPress={detach} label={t('detach')} />
        <View className="min-w-0 flex-1">
          <Text className="text-body" style={{ color: palette.text }} numberOfLines={1}>
            {terminal?.cwd ?? t('title')}
          </Text>
        </View>
        {status === 'ready' ? (
          <Text className="text-footnote" style={{ color: palette.textSecondary }}>
            {canControl ? t('controlling') : t('readOnly')}
          </Text>
        ) : null}
      </View>

      {truncated ? (
        <Text
          className="px-4 py-2 text-footnote"
          style={{ backgroundColor: palette.surface, color: palette.textSecondary }}
        >
          {t('truncated')}
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityRole="alert"
          className="px-4 py-2 text-footnote"
          style={{ backgroundColor: palette.surface, color: palette.danger }}
        >
          {t('error', { error })}
        </Text>
      ) : null}
      {exit ? (
        <Text
          className="px-4 py-2 text-footnote"
          style={{ backgroundColor: palette.surface, color: palette.textSecondary }}
        >
          {exit.code === null ? t('exitedSignal') : t('exited', { code: exit.code })}
        </Text>
      ) : null}

      {status === 'attaching' ? (
        <View className="flex-1 items-center justify-center gap-3">
          <ActivityIndicator color={palette.tint} />
          <Text className="text-subhead" style={{ color: palette.textSecondary }}>
            {t('attaching')}
          </Text>
        </View>
      ) : status === 'error' ? (
        <View className="flex-1 items-center justify-center">
          <ActionButton
            onPress={terminalId ? retry : detach}
            label={terminalId ? t('retry') : t('detach')}
          />
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
            <View className="flex-1">
              <ActionButton fullWidth variant="destructive" onPress={close} label={t('close')} />
            </View>
          ) : terminal?.managed ? (
            <Text
              className="flex-1 py-2 text-center text-subhead"
              style={{ color: palette.textSecondary }}
            >
              {t('managedReadOnly')}
            </Text>
          ) : (
            <View className="flex-1">
              <ActionButton
                fullWidth
                onPress={takeControl}
                disabled={takingControl}
                label={takingControl ? t('takingControl') : t('takeControl')}
              />
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}
