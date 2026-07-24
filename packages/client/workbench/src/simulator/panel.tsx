import { useLinkCodeClient } from '@linkcode/client-core';
import type {
  SessionId,
  SimulatorDevice,
  SimulatorOrientation,
  SimulatorStatus,
} from '@linkcode/schema';
import type {
  SimulatorKeyPress,
  SimulatorScreenFrame,
  SimulatorScreenPoint,
  SimulatorScreenTouchPhase,
} from '@linkcode/ui/shell/simulator';
import { SimulatorScreen } from '@linkcode/ui/shell/simulator';
import { Button } from 'coss-ui/components/button';
import { Select, SelectItem, SelectPopup, SelectPrimitive } from 'coss-ui/components/select';
import { useEffect } from 'foxact/use-abortable-effect';
import { noop } from 'foxts/noop';
import { ChevronDownIcon, HouseIcon, LockIcon, RotateCwIcon } from 'lucide-react';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import type { SimulatorStreamLease } from './stream-registry';
import { acquireSimulatorStream, peekSimulatorStream } from './stream-registry';

const BUSY_BANNER_MS = 3000;

/** Interface orientations in clockwise order, so the rotate button steps device rotation 90° CW
 * each press (portrait → home-on-right → upside-down → home-on-left → portrait). */
const ROTATE_CYCLE = [
  'portrait',
  'landscapeRight',
  'portraitUpsideDown',
  'landscapeLeft',
] as const satisfies readonly SimulatorOrientation[];

/** Toolbar buttons sit on the fixed-dark stage, so they use fixed neutrals: the ghost variant's
 * token-based accent hover would flash a light blob there in the light theme. */
const STAGE_BUTTON_CLASS =
  'text-neutral-300 hover:bg-white/10 hover:text-white data-pressed:bg-white/10 disabled:opacity-40';

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
  /** Screen-outline masks by udid as base64 PNGs; `null` = the host has none (generic rounding). */
  const [masks, setMasks] = useState<Readonly<Record<string, string | null>>>({});
  const [busy, setBusy] = useState(false);
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaseRef = useRef<SimulatorStreamLease | null>(null);
  const rotateStateRef = useRef<{ udid: string | null; orientation: SimulatorOrientation }>({
    udid: null,
    orientation: 'portrait',
  });

  useEffect(
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
  // Optimistic until the probe resolves: assume interactive so a capable host streams immediately.
  // A host with simctl but no SimulatorKit reports `interactive: false`; the live stream would only
  // fail there, so we gate it out and show a hint instead of an unrecoverable Retry loop.
  const interactive = status?.interactive ?? true;
  const canStream = sessionId !== null && udid !== null && booted && interactive;

  // Fetch bookkeeping lives in a ref (not `masks`) so the effect never loops on its own writes;
  // the cache write itself is deliberately not abort-gated — a udid switch mid-fetch must still
  // land the result for the next switch back.
  const maskFetchedRef = useRef(new Set<string>());
  useEffect(() => {
    if (udid === null || maskFetchedRef.current.has(udid)) return;
    maskFetchedRef.current.add(udid);
    void client
      .simulatorScreenMask(udid)
      .then((data) => setMasks((prev) => ({ ...prev, [udid]: data })))
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
  // Orientation is write-only (the guest never reports it back), so the rotate button just steps
  // clockwise from the last value we sent; a device switch resets the assumption to portrait.
  const handleRotate = (): void => {
    if (ownerSessionId === null || udid === null) return;
    const current =
      rotateStateRef.current.udid === udid ? rotateStateRef.current.orientation : 'portrait';
    const next = ROTATE_CYCLE[(ROTATE_CYCLE.indexOf(current) + 1) % ROTATE_CYCLE.length];
    // Advance the assumed orientation only once the rotation is acknowledged: a failed send (port
    // unvended, Mach send failed, transport down) must not desync the cycle from the device.
    void client
      .simulatorRotate(ownerSessionId, udid, next)
      .then(() => {
        rotateStateRef.current = { udid, orientation: next };
      })
      .catch(flagBusy);
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
      {deviceItems.length > 0 && device !== null && (
        <div className="flex shrink-0 items-center border-border border-b px-2 py-1.5">
          <Select items={deviceItems} value={device.udid} onValueChange={setSelectedUdid}>
            <SelectPrimitive.Trigger
              aria-label={t('simulatorSelectDevice')}
              className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate font-medium">{device.name}</span>
              {device.runtimeName !== undefined && (
                <span className="truncate text-muted-foreground">{device.runtimeName}</span>
              )}
              <SelectPrimitive.Icon>
                <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </SelectPrimitive.Icon>
            </SelectPrimitive.Trigger>
            <SelectPopup>
              {deviceItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      )}
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
        {device !== null && booted && sessionId !== null && !interactive && (
          <CenteredHint>{t('simulatorNonInteractive')}</CenteredHint>
        )}
        {canStream && (
          // The stage stays near-black in both themes (video-player convention) so the streamed
          // frame carries the contrast; everything on it uses fixed neutrals, not theme tokens.
          <div className="absolute inset-2 overflow-hidden rounded-lg bg-neutral-950">
            <SimulatorScreen
              key={udid}
              subscribeFrames={subscribeFrames}
              onTouch={handleTouch}
              onPinch={handlePinch}
              onKey={handleKey}
              onText={handleText}
              maskPng={masks[udid] ?? null}
              placeholder={
                <span className="text-neutral-400 text-sm">{t('simulatorConnecting')}</span>
              }
              className="px-3 pt-3 pb-16"
            />
            <div className="-translate-x-1/2 absolute bottom-3 left-1/2 flex items-center gap-0.5 rounded-full border border-white/10 bg-neutral-900/90 px-1.5 py-1 shadow-lg">
              <Button
                variant="ghost"
                size="icon-sm"
                className={STAGE_BUTTON_CLASS}
                aria-label={t('simulatorHome')}
                disabled={ownerSessionId === null}
                onClick={() => pressButton('home')}
              >
                <HouseIcon className="size-4" />
              </Button>
              <div className="mx-0.5 h-4 w-px bg-white/15" />
              <Button
                variant="ghost"
                size="icon-sm"
                className={STAGE_BUTTON_CLASS}
                aria-label={t('simulatorRotate')}
                disabled={ownerSessionId === null}
                onClick={handleRotate}
              >
                <RotateCwIcon className="size-4" />
              </Button>
              <div className="mx-0.5 h-4 w-px bg-white/15" />
              <Button
                variant="ghost"
                size="icon-sm"
                className={STAGE_BUTTON_CLASS}
                aria-label={t('simulatorLock')}
                disabled={ownerSessionId === null}
                onClick={() => pressButton('lock')}
              >
                <LockIcon className="size-4" />
              </Button>
            </div>
          </div>
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
