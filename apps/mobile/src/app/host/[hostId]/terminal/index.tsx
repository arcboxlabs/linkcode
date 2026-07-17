import { useLinkCodeClient } from '@linkcode/client-core';
import type { TerminalMetadata } from '@linkcode/schema';
import { EmptyState, ScreenScroll } from '@linkcode/ui/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { Button, Card, Chip, Input, Label, ListGroup, Spinner, TextField } from 'heroui-native';
import { useCallback, useState } from 'react';
import { RefreshControl, Text, View } from 'react-native';
import { useTranslations } from 'use-intl';

const INITIAL_TERMINAL_SIZE = { cols: 80, rows: 24 };

/** Host terminal inbox: attach to a running PTY or start a new one on the host. */
export default function TerminalsScreen(): React.ReactNode {
  const t = useTranslations('mobile.terminals');
  const router = useRouter();
  const { hostId } = useLocalSearchParams<{ hostId: string }>();
  const client = useLinkCodeClient();
  const [terminals, setTerminals] = useState<TerminalMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cwd, setCwd] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => client.listTerminals(), [client]);

  useAbortableEffect(
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

  const onRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      setTerminals(await load());
    } catch (error_) {
      setError(extractErrorMessage(error_, false) ?? 'Unknown error');
    } finally {
      setRefreshing(false);
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
      const trimmedCwd = cwd.trim();
      const terminalId = await client.openTerminal({
        ...INITIAL_TERMINAL_SIZE,
        cwd: trimmedCwd || undefined,
      });
      client.detachTerminal(terminalId);
      setCwd('');
      openTerminal(terminalId, true);
    } catch (error_) {
      setError(extractErrorMessage(error_, false) ?? 'Unknown error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <ScreenScroll
      title={t('title')}
      keyboardAware
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      headerRight={
        <Button variant="ghost" size="sm" onPress={() => router.back()}>
          <Button.Label>{t('back')}</Button.Label>
        </Button>
      }
    >
      {error ? <Text className="text-[13px] text-danger">{t('error', { error })}</Text> : null}

      {loading ? (
        <View className="items-center py-8">
          <Spinner />
        </View>
      ) : terminals.length === 0 ? (
        <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
      ) : (
        <ListGroup>
          {terminals.map((terminal) => (
            <ListGroup.Item
              key={terminal.terminalId}
              onPress={() => openTerminal(terminal.terminalId)}
            >
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>
                  {terminal.shell ?? terminal.terminalId.slice(0, 8)}
                </ListGroup.ItemTitle>
                <ListGroup.ItemDescription numberOfLines={1}>
                  {terminal.cwd ?? t('unknownCwd')} · {terminal.cols}×{terminal.rows}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <Chip
                  variant="soft"
                  size="sm"
                  color={terminal.controllerAttachmentId ? 'accent' : 'default'}
                >
                  <Chip.Label>
                    {terminal.controllerAttachmentId ? t('controlled') : t('uncontrolled')}
                  </Chip.Label>
                </Chip>
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}

      <Card>
        <Card.Header>
          <Card.Title>{t('newTerminal')}</Card.Title>
        </Card.Header>
        <Card.Body className="gap-4">
          <TextField>
            <Label>{t('cwdLabel')}</Label>
            <Input
              value={cwd}
              onChangeText={setCwd}
              placeholder={t('cwdPlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </TextField>
          <Button onPress={onCreate} isDisabled={creating}>
            <Button.Label>{creating ? t('creating') : t('create')}</Button.Label>
          </Button>
        </Card.Body>
      </Card>
    </ScreenScroll>
  );
}
