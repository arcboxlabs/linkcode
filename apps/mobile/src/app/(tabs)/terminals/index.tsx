import {
  Button,
  ContentUnavailableView,
  Form,
  Host,
  ProgressView,
  Section,
  Text,
} from '@expo/ui/swift-ui';
import { foregroundStyle, refreshable } from '@expo/ui/swift-ui/modifiers';
import { useLinkCodeClient } from '@linkcode/client-core';
import type { TerminalMetadata } from '@linkcode/schema';
import { repositoryLabel } from '@linkcode/ui/native';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { HostClientGate } from '@mobile/components/host/host-client-gate';
import { useHostMenuItems } from '@mobile/components/host/use-host-menu-items';
import { HeaderIconButton } from '@mobile/components/shell/header-icon-button';
import { NewTerminalSheet } from '@mobile/components/terminal/new-terminal-sheet';
import { useHostConnection } from '@mobile/runtime/host-connection';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { PlusIcon } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Platform, View } from 'react-native';
import { useTranslations } from 'use-intl';

const INITIAL_TERMINAL_SIZE = { cols: 80, rows: 24 };

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const SUPPORTS_CONTENT_UNAVAILABLE_VIEW =
  Platform.OS === 'ios' && Number.parseInt(Platform.Version, 10) >= 17;

/** Header above the gate, for the same reason as the threads tab: the host switcher has to stay
 * reachable when the host is not. */
export default function TerminalsRoute(): React.ReactNode {
  const t = useTranslations('mobile.terminals');
  const hostMenuItems = useHostMenuItems();
  const connection = useHostConnection();
  const [sheetOpen, setSheetOpen] = useState(false);

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
          headerRight:
            connection?.status === 'ready'
              ? () => (
                  <HeaderIconButton
                    icon={PlusIcon}
                    label={t('newTerminal')}
                    onPress={() => setSheetOpen(true)}
                  />
                )
              : undefined,
        }}
      />
      <HostClientGate>
        <TerminalsScreen
          key={connection?.host.id}
          sheetOpen={sheetOpen}
          onSheetOpenChange={setSheetOpen}
        />
      </HostClientGate>
    </View>
  );
}

/** Host terminal inbox: attach to a running PTY or start a new one on the host. */
function TerminalsScreen({
  sheetOpen,
  onSheetOpenChange,
}: {
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
}): React.ReactNode {
  const t = useTranslations('mobile.terminals');
  const router = useRouter();
  const client = useLinkCodeClient();
  const [terminals, setTerminals] = useState<TerminalMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(
    async () => (await client.listTerminals()).sort((a, b) => b.createdAt - a.createdAt),
    [client],
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoadError(null);
      void load()
        .then((nextTerminals) => {
          if (active) setTerminals(nextTerminals);
        })
        .catch((error_: unknown) => {
          if (active) setLoadError(extractErrorMessage(error_, false) ?? 'Unknown error');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [load]),
  );

  // Drives SwiftUI's own pull-to-refresh, which keeps its spinner until this resolves.
  const onRefresh = async () => {
    setLoadError(null);
    try {
      setTerminals(await load());
    } catch (error_) {
      setLoadError(extractErrorMessage(error_, false) ?? 'Unknown error');
    }
  };

  const openTerminal = (terminalId: string, takeControl = false) => {
    const query = takeControl ? '?takeover=1' : '';
    router.push(`/terminal/${encodeURIComponent(terminalId)}${query}`);
  };

  const onCreate = async (cwd: string): Promise<boolean> => {
    if (creating) return false;
    setCreating(true);
    setCreateError(null);
    try {
      const terminalId = await client.openTerminal({
        ...INITIAL_TERMINAL_SIZE,
        cwd: cwd || undefined,
      });
      client.detachTerminal(terminalId);
      onSheetOpenChange(false);
      openTerminal(terminalId, true);
      return true;
    } catch (error_) {
      setCreateError(extractErrorMessage(error_, false) ?? 'Unknown error');
      return false;
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      {/* Form needs the viewport as its proposed size, otherwise it collapses to its content. */}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {loading ? (
          <ProgressView />
        ) : loadError && terminals.length === 0 ? (
          <Form>
            <Section>
              <Text modifiers={[foregroundStyle('red')]}>
                {t('loadError', { error: loadError })}
              </Text>
              <Button
                label={t('retry')}
                onPress={() => {
                  setLoading(true);
                  void onRefresh().finally(() => setLoading(false));
                }}
              />
            </Section>
          </Form>
        ) : terminals.length === 0 ? (
          SUPPORTS_CONTENT_UNAVAILABLE_VIEW ? (
            <ContentUnavailableView
              title={t('emptyTitle')}
              systemImage="terminal"
              description={t('emptyHint')}
              modifiers={[refreshable(onRefresh)]}
            />
          ) : (
            <Form modifiers={[refreshable(onRefresh)]}>
              <Section>
                <Text modifiers={[SECONDARY]}>{t('emptyHint')}</Text>
              </Section>
            </Form>
          )
        ) : (
          <Form modifiers={[refreshable(onRefresh)]}>
            {loadError ? (
              <Section>
                <Text modifiers={[foregroundStyle('red')]}>
                  {t('loadError', { error: loadError })}
                </Text>
              </Section>
            ) : null}
            <Section>
              {terminals.map((terminal) => (
                <NavigationRow
                  key={terminal.terminalId}
                  title={
                    terminal.cwd ? repositoryLabel(terminal.cwd) : terminal.terminalId.slice(0, 8)
                  }
                  subtitle={`${terminal.shell ? repositoryLabel(terminal.shell) : terminal.terminalId.slice(0, 8)} · ${terminal.cols}×${terminal.rows}`}
                  badgeText={terminal.controllerAttachmentId ? t('controlled') : undefined}
                  onPress={() => openTerminal(terminal.terminalId)}
                />
              ))}
            </Section>
          </Form>
        )}
      </Host>
      <NewTerminalSheet
        isPresented={sheetOpen}
        onIsPresentedChange={(open) => {
          if (!open) setCreateError(null);
          onSheetOpenChange(open);
        }}
        creating={creating}
        error={createError}
        onCreate={onCreate}
      />
    </>
  );
}
