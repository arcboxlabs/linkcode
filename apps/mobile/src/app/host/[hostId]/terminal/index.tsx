import {
  Button,
  Form,
  Host,
  HStack,
  ProgressView,
  Section,
  Text,
  TextField,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  disabled,
  foregroundStyle,
  refreshable,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import { useLinkCodeClient } from '@linkcode/client-core';
import type { TerminalMetadata } from '@linkcode/schema';
import { NavigationRow } from '@mobile/components/form/form-row';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useCallback, useState } from 'react';
import { useTranslations } from 'use-intl';

const INITIAL_TERMINAL_SIZE = { cols: 80, rows: 24 };

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

/** Host terminal inbox: attach to a running PTY or start a new one on the host. */
export default function TerminalsScreen(): React.ReactNode {
  const t = useTranslations('mobile.terminals');
  const router = useRouter();
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const client = useLinkCodeClient();
  const [terminals, setTerminals] = useState<TerminalMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Native-backed so the value read on create is the field's own, not a mirrored copy.
  const cwd = useNativeState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => client.listTerminals(), [client]);

  useEffect(
    (signal) => {
      void load()
        .then((nextTerminals) => {
          if (!signal.aborted) setTerminals(nextTerminals);
        })
        .catch((error_: unknown) => {
          if (!signal.aborted) {
            setError(extractErrorMessage(error_, false) ?? 'Unknown error');
          }
        })
        .finally(() => {
          if (!signal.aborted) setLoading(false);
        });
    },
    [load],
  );

  // Drives SwiftUI's own pull-to-refresh, which keeps its spinner until this resolves.
  const onRefresh = async () => {
    setError(null);
    try {
      setTerminals(await load());
    } catch (error_) {
      setError(extractErrorMessage(error_, false) ?? 'Unknown error');
    }
  };

  const openTerminal = (terminalId: string, takeControl = false) => {
    const query = takeControl ? '?takeover=1' : '';
    router.push(`/host/${hostId}/terminal/${encodeURIComponent(terminalId)}${query}`);
  };

  const onCreate = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      const trimmedCwd = cwd.get().trim();
      const terminalId = await client.openTerminal({
        ...INITIAL_TERMINAL_SIZE,
        cwd: trimmedCwd || undefined,
      });
      client.detachTerminal(terminalId);
      cwd.set('');
      openTerminal(terminalId, true);
    } catch (error_) {
      setError(extractErrorMessage(error_, false) ?? 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('title') }} />
      {/* Form needs the viewport as its proposed size, otherwise it collapses to its content. */}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        <Form modifiers={[refreshable(onRefresh)]}>
          {error ? (
            <Section>
              <Text modifiers={[foregroundStyle('red')]}>{t('error', { error })}</Text>
            </Section>
          ) : null}

          <Section>
            {loading ? (
              <ProgressView />
            ) : terminals.length === 0 ? (
              <Text modifiers={[SECONDARY]}>{t('emptyHint')}</Text>
            ) : (
              terminals.map((terminal) => (
                <NavigationRow
                  key={terminal.terminalId}
                  title={terminal.shell ?? terminal.terminalId.slice(0, 8)}
                  subtitle={`${terminal.cwd ?? t('unknownCwd')} · ${terminal.cols}×${terminal.rows}`}
                  badgeText={terminal.controllerAttachmentId ? t('controlled') : undefined}
                  onPress={() => openTerminal(terminal.terminalId)}
                />
              ))
            )}
          </Section>

          <Section title={t('newTerminal')}>
            <HStack spacing={12}>
              <Text>{t('cwdLabel')}</Text>
              <TextField
                testID="terminal-cwd-input"
                text={cwd}
                placeholder={t('cwdPlaceholder')}
                modifiers={[textInputAutocapitalization('never'), autocorrectionDisabled()]}
              />
            </HStack>
            <Button
              label={creating ? t('creating') : t('create')}
              onPress={onCreate}
              modifiers={[disabled(creating)]}
            />
          </Section>
        </Form>
      </Host>
    </>
  );
}
