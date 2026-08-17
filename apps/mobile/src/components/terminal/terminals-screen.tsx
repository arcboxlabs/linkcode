import { Button, LazyColumn, PullToRefreshBox, Text } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding } from '@expo/ui/jetpack-compose/modifiers';
import { repositoryLabel } from '@linkcode/ui/native';
import { FormList } from '@mobile/components/form/list.android';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { FormHint, FormLoadingRow } from '@mobile/components/form/rows.android';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import { NewTerminalSheet } from '@mobile/components/terminal/new-terminal-sheet';
import { useTerminalInbox } from '@mobile/components/terminal/use-terminal-inbox';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

/** Android terminal inbox body, mirroring `terminals-screen.ios.tsx` with MD3 list rows and a
 * controlled PullToRefreshBox in place of SwiftUI's awaiting `refreshable`. */
export function TerminalsScreen({
  sheetOpen,
  onSheetOpenChange,
}: {
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
}): React.ReactNode {
  const t = useTranslations('mobile.terminals');
  const {
    terminals,
    loading,
    loadError,
    createError,
    creating,
    onRefresh,
    retry,
    openTerminal,
    onCreate,
  } = useTerminalInbox(() => onSheetOpenChange(false));
  const [refreshing, setRefreshing] = useState(false);

  const refresh = () => {
    setRefreshing(true);
    void onRefresh().finally(() => setRefreshing(false));
  };

  return (
    <>
      {loading ? (
        <FormList>
          <FormLoadingRow />
        </FormList>
      ) : loadError && terminals.length === 0 ? (
        <FormList>
          <FormHint tone="error">{t('loadError', { error: loadError })}</FormHint>
          <Button onClick={retry} modifiers={[padding(16, 4, 16, 4)]}>
            <Text>{t('retry')}</Text>
          </Button>
        </FormList>
      ) : (
        <ThemedHost style={{ flex: 1 }} useViewportSizeMeasurement>
          <PullToRefreshBox isRefreshing={refreshing} onRefresh={refresh}>
            <LazyColumn contentPadding={{ top: 8, bottom: 24 }} modifiers={[fillMaxWidth()]}>
              {loadError ? (
                <FormHint tone="error">{t('loadError', { error: loadError })}</FormHint>
              ) : null}
              {terminals.length === 0 ? (
                <FormHint>{t('emptyHint')}</FormHint>
              ) : (
                terminals.map((terminal) => (
                  <NavigationRow
                    key={terminal.terminalId}
                    title={
                      terminal.cwd ? repositoryLabel(terminal.cwd) : terminal.terminalId.slice(0, 8)
                    }
                    subtitle={`${terminal.shell ? repositoryLabel(terminal.shell) : terminal.terminalId.slice(0, 8)} · ${terminal.cols}×${terminal.rows}`}
                    badgeText={terminal.controllerAttachmentId ? t('controlled') : undefined}
                    onPress={() => openTerminal(terminal.terminalId)}
                  />
                ))
              )}
            </LazyColumn>
          </PullToRefreshBox>
        </ThemedHost>
      )}
      <NewTerminalSheet
        isPresented={sheetOpen}
        onIsPresentedChange={onSheetOpenChange}
        creating={creating}
        error={createError}
        onCreate={onCreate}
      />
    </>
  );
}
