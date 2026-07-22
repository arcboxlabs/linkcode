import { useLinkCodeClient } from '@linkcode/client-core';
import type { SessionId, SimulatorDevice, SimulatorStatus } from '@linkcode/schema';
import type {
  SimulatorKeyPress,
  SimulatorScreenFrame,
  SimulatorScreenPoint,
  SimulatorScreenTouchPhase,
} from '@linkcode/ui/shell/simulator';
import { SimulatorScreen } from '@linkcode/ui/shell/simulator';
import { Button } from 'coss-ui/components/button';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { noop } from 'foxts/noop';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import type { SimulatorStreamLease } from './stream-registry';
import { acquireSimulatorStream, peekSimulatorStream } from './stream-registry';

const BUSY_BANNER_MS = 3000;

/**
 * The right panel's Simulator section: device picker plus a live, touchable device screen.
 * Interactions ride the session that started the stream (it holds the device claim), so the
 * user co-drives the same device an agent is using; a claim conflict surfaces as a banner.
 */
export function SimulatorPanel({ sessionId }: { sessionId: SessionId | null }): React.ReactNode {
  const t = useTranslations('workbench.panel');
  const client = useLinkCodeClient();
  const [status, setStatus] = useState<SimulatorStatus | null>(null);
  const [devices, setDevices] = useState<SimulatorDevice[] | null>(null);
  const [selectedUdid, setSelectedUdid] = useState<string | null>(null);
  /** Screen-outline masks by udid; `null` = the host has none (fall back to generic rounding). */
  const [masks, setMasks] = useState<Readonly<Record<string, string | null>>>({});
  const [busy, setBusy] = useState(false);
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaseRef = useRef<SimulatorStreamLease | null>(null);

  useAbortableEffect(
    (signal) => {
      void client
        .simulatorStatus()
        .then((value) => {
          if (!signal.aborted) setStatus(value);
        })
        .catch(() => {
          if (!signal.aborted) setStatus({ available: false });
        });
      void client
        .simulatorList()
        .then((value) => {
          if (!signal.aborted) setDevices(value);
        })
        .catch(() => {
          if (!signal.aborted) setDevices([]);
        });
      const unsubscribe = client.subscribeSimulatorDevicesChanged(setDevices);
      return () => {
        unsubscribe();
        clearTimeout(busyTimerRef.current);
      };
    },
    [client],
  );

  const device = pickDevice(devices, selectedUdid);
  const udid = device?.udid ?? null;
  const booted = device?.state === 'Booted';
  const canStream = sessionId !== null && udid !== null && booted;

  // Fetch bookkeeping lives in a ref (not `masks`) so the effect never loops on its own writes;
  // the cache write itself is deliberately not abort-gated — a udid switch mid-fetch must still
  // land the result for the next switch back.
  const maskFetchedRef = useRef(new Set<string>());
  useAbortableEffect(() => {
    if (udid === null || maskFetchedRef.current.has(udid)) return;
    maskFetchedRef.current.add(udid);
    void client
      .simulatorScreenMask(udid)
      .then((data) => setMasks((prev) => ({ ...prev, [udid]: `data:image/png;base64,${data}` })))
      .catch(() => setMasks((prev) => ({ ...prev, [udid]: null })));
  }, [client, udid]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (sessionId === null || udid === null || !booted) return noop;
      const lease = acquireSimulatorStream(client, udid, sessionId);
      leaseRef.current = lease;
      const unsubscribe = lease.subscribe(onStoreChange);
      return () => {
        unsubscribe();
        lease.release();
        if (leaseRef.current === lease) leaseRef.current = null;
      };
    },
    [client, sessionId, udid, booted],
  );
  const snapshot = useSyncExternalStore(subscribe, () =>
    canStream ? peekSimulatorStream(client, udid) : null,
  );
  /** The claim-holding session every interaction must ride. */
  const ownerSessionId = snapshot?.sessionId ?? null;

  const subscribeFrames = useCallback(
    (onFrame: (frame: SimulatorScreenFrame) => void) =>
      udid === null
        ? noop
        : client.subscribeSimulatorFrames(udid, (frame) =>
            onFrame({ codec: frame.codec, key: frame.key, data: frame.data }),
          ),
    [client, udid],
  );

  const flagBusy = useCallback(() => {
    setBusy(true);
    clearTimeout(busyTimerRef.current);
    busyTimerRef.current = setTimeout(() => setBusy(false), BUSY_BANNER_MS);
  }, []);

  if (status !== null && !status.available) {
    return <CenteredHint>{t('simulatorUnavailable')}</CenteredHint>;
  }

  const handleTouch = (phase: SimulatorScreenTouchPhase, point: SimulatorScreenPoint): void => {
    if (ownerSessionId === null || udid === null) return;
    const request = client.simulatorTouch(ownerSessionId, udid, phase, point.x, point.y);
    // Surface a claim conflict once per gesture, not per 60 Hz move.
    void request.catch(phase === 'down' ? flagBusy : noop);
  };
  const handlePinch = (
    phase: SimulatorScreenTouchPhase,
    a: SimulatorScreenPoint,
    b: SimulatorScreenPoint,
  ): void => {
    if (ownerSessionId === null || udid === null) return;
    void client
      .simulatorPinch(ownerSessionId, udid, phase, a, b)
      .catch(phase === 'down' ? flagBusy : noop);
  };
  const handleKey = (press: SimulatorKeyPress): void => {
    if (ownerSessionId === null || udid === null) return;
    void client.simulatorKey(ownerSessionId, udid, press.usage, press.modifiers).catch(flagBusy);
  };
  const handleText = (text: string): void => {
    if (ownerSessionId === null || udid === null) return;
    // Set the pasteboard, then Cmd+V (Left GUI usage 0xE3 + V usage 0x19) so iOS pastes it.
    void client
      .simulatorPaste(ownerSessionId, udid, text)
      .then(() => client.simulatorKey(ownerSessionId, udid, 0x19, [0xe3]))
      .catch(flagBusy);
  };
  const pressButton = (button: 'home' | 'lock'): void => {
    if (ownerSessionId === null || udid === null) return;
    void client.simulatorButton(ownerSessionId, udid, button).catch(flagBusy);
  };
  const bootDevice = (): void => {
    if (sessionId === null || udid === null) return;
    void client.simulatorBoot(sessionId, udid).catch(flagBusy);
  };

  const deviceItems = (devices ?? []).map((item) => ({
    value: item.udid,
    label: item.runtimeName === undefined ? item.name : `${item.name} · ${item.runtimeName}`,
  }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-border border-b px-2 py-1.5">
        {deviceItems.length > 0 && udid !== null && (
          <Select items={deviceItems} value={udid} onValueChange={setSelectedUdid}>
            <SelectTrigger className="h-7 min-w-0 flex-1" aria-label={t('simulatorSelectDevice')}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {deviceItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={ownerSessionId === null}
            onClick={() => pressButton('home')}
          >
            {t('simulatorHome')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={ownerSessionId === null}
            onClick={() => pressButton('lock')}
          >
            {t('simulatorLock')}
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {devices !== null && devices.length === 0 && (
          <CenteredHint>{t('simulatorNoDevices')}</CenteredHint>
        )}
        {device !== null && !booted && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            {device.state === 'Booting' ? (
              <span className="text-muted-foreground text-sm">{t('simulatorBooting')}</span>
            ) : sessionId === null ? (
              <span className="text-muted-foreground text-sm">{t('simulatorNoSession')}</span>
            ) : (
              <Button variant="outline" size="sm" onClick={bootDevice}>
                {t('simulatorBoot')}
              </Button>
            )}
          </div>
        )}
        {device !== null && booted && sessionId === null && (
          <CenteredHint>{t('simulatorNoSession')}</CenteredHint>
        )}
        {canStream && (
          <SimulatorScreen
            key={udid}
            subscribeFrames={subscribeFrames}
            onTouch={handleTouch}
            onPinch={handlePinch}
            onKey={handleKey}
            onText={handleText}
            maskUrl={masks[udid] ?? null}
            placeholder={
              <span className="text-muted-foreground text-sm">{t('simulatorConnecting')}</span>
            }
            className="p-2"
          />
        )}
        {snapshot?.phase === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80">
            <span className="text-muted-foreground text-sm">{t('simulatorStreamFailed')}</span>
            <Button variant="outline" size="sm" onClick={() => leaseRef.current?.restart()}>
              {t('simulatorRetry')}
            </Button>
          </div>
        )}
        {busy && (
          <div className="absolute inset-x-0 bottom-3 flex justify-center">
            <div className="rounded-md border border-border bg-background/95 px-3 py-1.5 text-muted-foreground text-xs shadow-sm">
              {t('simulatorBusy')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CenteredHint({ children }: React.PropsWithChildren): React.ReactNode {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-muted-foreground text-sm">
      {children}
    </div>
  );
}

function pickDevice(
  devices: SimulatorDevice[] | null,
  selectedUdid: string | null,
): SimulatorDevice | null {
  if (!devices || devices.length === 0) return null;
  const picked =
    selectedUdid === null ? undefined : devices.find((item) => item.udid === selectedUdid);
  return picked ?? devices.find((item) => item.state === 'Booted') ?? devices[0];
}
