import { Button, ContentUnavailableView, Form, Host, Section, Text } from '@expo/ui/swift-ui';
import { foregroundStyle, refreshable } from '@expo/ui/swift-ui/modifiers';
import { repositoryLabel } from '@linkcode/ui/native';
import { LoadingView } from '@mobile/components/form/loading-view.ios';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { NewTerminalSheet } from '@mobile/components/terminal/new-terminal-sheet';
import { useTerminalInbox } from '@mobile/components/terminal/use-terminal-inbox';
import { Platform } from 'react-native';
import { useTranslations } from 'use-intl';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const SUPPORTS_CONTENT_UNAVAILABLE_VIEW =
  Platform.OS === 'ios' && Number.parseInt(Platform.Version, 10) >= 17;

/** Host terminal inbox body: attach to a running PTY or start a new one on the host. */
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

  return (
    <>
      {/* Form needs the viewport as its proposed size, otherwise it collapses to its content. */}
      <Host style={{ flex: 1 }} useViewportSizeMeasurement>
        {loading ? (
          <LoadingView />
        ) : loadError && terminals.length === 0 ? (
          <Form>
            <Section>
              <Text modifiers={[foregroundStyle('red')]}>
                {t('loadError', { error: loadError })}
              </Text>
              <Button label={t('retry')} onPress={retry} />
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
          onSheetOpenChange(open);
        }}
        creating={creating}
        error={createError}
        onCreate={onCreate}
      />
    </>
  );
}
