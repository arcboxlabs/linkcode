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
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { HostClientGate } from '@mobile/components/host/host-client-gate';
import { useHostMenuItems } from '@mobile/components/host/use-host-menu-items';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

const INITIAL_TERMINAL_SIZE = { cols: 80, rows: 24 };

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });

/** Header above the gate, for the same reason as the threads tab: the host switcher has to stay
 * reachable when the host is not. */
export default function TerminalsRoute(): React.ReactNode {
  const t = useTranslations('mobile.terminals');
  const hostMenuItems = useHostMenuItems();

  // The flex container is load-bearing: a SwiftUI host left as the screen's direct child is
  // proposed the whole window and paints straight over the large title.
  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          headerShown: true,
          headerLargeTitle: true,
          title: t('title'),
          unstable_headerLeftItems: () => hostMenuItems,
        }}
      />
      <HostClientGate>
        <TerminalsScreen />
      </HostClientGate>
    </View>
  );
}

/** Host terminal inbox: attach to a running PTY or start a new one on the host. */
function TerminalsScreen(): React.ReactNode {
  const t = useTranslations('mobile.terminals');
  const router = useRouter();
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
    router.push(`/terminal/${encodeURIComponent(terminalId)}${query}`);
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
    // Form needs the viewport as its proposed size, otherwise it collapses to its content.
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
  );
}
