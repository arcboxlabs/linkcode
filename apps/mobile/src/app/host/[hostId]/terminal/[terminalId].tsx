import { useLinkCodeClient } from '@linkcode/client-core';
import type { TerminalMetadata, TerminalReplayEvent } from '@linkcode/schema';
import { TerminalIdSchema } from '@linkcode/schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { Button, Chip, Spinner } from 'heroui-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import TerminalRenderer from '../../../../components/terminal-renderer';
import type { TerminalRendererRef } from '../../../../components/terminal-renderer.types';

type AttachStatus = 'attaching' | 'ready' | 'error';

/** Interactive mobile view of one host-owned PTY. */
export default function TerminalScreen(): React.ReactNode {
  const t = useTranslations('mobile.terminal');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useLinkCodeClient();
  const params = useLocalSearchParams<{ terminalId: string; takeover?: string }>();
  const parsed = TerminalIdSchema.safeParse(params.terminalId);
  const terminalId = parsed.success ? parsed.data : null;
  const autoTakeControl = params.takeover === '1';
  const rendererRef = useRef<TerminalRendererRef>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<AttachStatus>(terminalId ? 'attaching' : 'error');
  const [terminal, setTerminal] = useState<TerminalMetadata | null>(null);
  const [canControl, setCanControl] = useState(false);
  const [takingControl, setTakingControl] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [rendererGeneration, setRendererGeneration] = useState(0);
  const [error, setError] = useState<string | null>(() => (terminalId ? null : t('invalidId')));
  const [exit, setExit] = useState<{ code: number | null } | null>(null);

  useAbortableEffect(
    (signal) => {
      if (!terminalId) return;
      const offController = client.subscribeTerminalController(terminalId, (controlled) => {
        if (!signal.aborted) setCanControl(controlled);
      });
      const offExit = client.subscribeTerminalExit(terminalId, (code) => {
        if (signal.aborted) return;
        setExit({ code });
        setCanControl(false);
      });
      const offError = client.subscribeTerminalError(terminalId, (cause) => {
        if (!signal.aborted) setError(cause.message);
      });
      const offReplayTruncated = client.subscribeTerminalReplayTruncated(
        terminalId,
        (wasTruncated) => {
          if (!signal.aborted) setTruncated(wasTruncated);
        },
      );

      void (async () => {
        try {
          const result = await client.attachTerminal(terminalId);
          if (signal.aborted) return;
          setTerminal(result.terminal);
          setTruncated(result.truncated);
          setCanControl(client.terminalCanControl(terminalId));
          setStatus('ready');

          if (autoTakeControl && !result.terminal.managed) {
            setTakingControl(true);
            try {
              const controlled = await client.takeTerminalControl(terminalId);
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- AbortSignal may change while the request is pending.
              if (signal.aborted) return;
              setTruncated((current) => current || controlled.truncated);
              setCanControl(client.terminalCanControl(terminalId));
            } catch (error_) {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- AbortSignal may change while the request is pending.
              if (!signal.aborted) {
                setError(extractErrorMessage(error_, false) ?? 'Unknown error');
              }
            } finally {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- AbortSignal may change while the request is pending.
              if (!signal.aborted) setTakingControl(false);
            }
          }
        } catch (error_) {
          if (signal.aborted) return;
          setError(extractErrorMessage(error_, false) ?? 'Unknown error');
          setStatus('error');
        }
      })();

      return () => {
        offController();
        offExit();
        offError();
        offReplayTruncated();
        client.detachTerminal(terminalId);
      };
    },
    [attempt, autoTakeControl, client, terminalId],
  );

  useEffect(() => {
    if (rendererGeneration === 0 || status !== 'ready' || !terminalId) return;

    const deliver = (events: readonly TerminalReplayEvent[]) => {
      rendererRef.current?.events(events);
    };
    let replaying = true;
    const replay: TerminalReplayEvent[] = [];
    const unsubscribe = client.subscribeTerminalEvents(terminalId, (event) => {
      if (replaying) {
        replay.push(event);
        return;
      }
      deliver([event]);
    });
    replaying = false;
    deliver(replay);
    return unsubscribe;
  }, [client, rendererGeneration, status, terminalId]);

  useEffect(() => {
    if (rendererGeneration === 0 || !exit) return;
    rendererRef.current?.exit(exit.code);
  }, [exit, rendererGeneration]);

  const onInput = useCallback(
    (data: string) => {
      if (terminalId) client.terminalInput(terminalId, data);
    },
    [client, terminalId],
  );
  const onResize = useCallback(
    (cols: number, rows: number) => {
      if (terminalId) client.resizeTerminal(terminalId, cols, rows);
    },
    [client, terminalId],
  );
  const onRendererReady = useCallback(() => {
    setRendererGeneration((current) => current + 1);
  }, []);
  const onRendererError = useCallback((message: string) => {
    setError(message);
  }, []);

  const takeControl = async () => {
    if (!terminalId || takingControl) return;
    setTakingControl(true);
    setError(null);
    try {
      const result = await client.takeTerminalControl(terminalId);
      setTruncated((current) => current || result.truncated);
      setCanControl(client.terminalCanControl(terminalId));
    } catch (error_) {
      setError(extractErrorMessage(error_, false) ?? 'Unknown error');
    } finally {
      setTakingControl(false);
    }
  };

  const detach = () => {
    router.back();
  };

  const close = () => {
    if (terminalId) client.closeTerminal(terminalId);
  };

  const retry = () => {
    if (!terminalId) {
      detach();
      return;
    }
    setStatus('attaching');
    setError(null);
    setExit(null);
    setTerminal(null);
    setCanControl(false);
    setTakingControl(false);
    setTruncated(false);
    setRendererGeneration(0);
    setAttempt((current) => current + 1);
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
          <Text className="text-[15px] text-foreground" numberOfLines={1}>
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
        <Text className="bg-warning/10 px-4 py-2 text-[12px] text-warning">{t('truncated')}</Text>
      ) : null}
      {error ? (
        <Text className="bg-danger/10 px-4 py-2 text-[12px] text-danger">
          {t('error', { error })}
        </Text>
      ) : null}
      {exit ? (
        <Text className="bg-default/10 px-4 py-2 text-[12px] text-muted">
          {exit.code === null ? t('exitedSignal') : t('exited', { code: exit.code })}
        </Text>
      ) : null}

      {status === 'attaching' ? (
        <View className="flex-1 items-center justify-center gap-3">
          <Spinner />
          <Text className="text-[13px] text-muted">{t('attaching')}</Text>
        </View>
      ) : status === 'error' ? (
        <View className="flex-1 items-center justify-center">
          <Button onPress={retry}>
            <Button.Label>{terminalId ? t('retry') : t('detach')}</Button.Label>
          </Button>
        </View>
      ) : (
        <TerminalRenderer
          ref={rendererRef}
          canControl={canControl && exit === null}
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
            <Text className="flex-1 py-2 text-center text-[13px] text-muted">
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
