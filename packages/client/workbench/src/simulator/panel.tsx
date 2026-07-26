import { useLinkCodeClient } from '@linkcode/client-core';
import type {
  SessionId,
  SimulatorButton,
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
import { Checkbox } from 'coss-ui/components/checkbox';
import { Select, SelectItem, SelectPopup, SelectPrimitive } from 'coss-ui/components/select';
import { useEffect } from 'foxact/use-abortable-effect';
import { noop } from 'foxts/noop';
import {
  BotIcon,
  BotOffIcon,
  CameraIcon,
  ChevronDownIcon,
  CircleStopIcon,
  HouseIcon,
  LockIcon,
  PowerIcon,
  RotateCwIcon,
  UnplugIcon,
  VideoIcon,
} from 'lucide-react';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { useSimulatorAgentActivity } from './agent-activity';
import { useBackgroundSimulatorStreams } from './background-streams';
import { base64Blob, captureFileStem, downloadBlob, useSimulatorRecorder } from './capture';
import { useSimulatorConsent, useSimulatorConsentRequest } from './consent';
import { SimulatorDeviceTabs } from './device-tabs';
import { selectDeviceTabs, simulatorSessionKey, useSimulatorPanelStore } from './panel-store';
import { useSimulatorShortcuts } from './shortcuts';
import type { SimulatorStreamLease } from './stream-registry';
import {
  acquireSimulatorStream,
  peekSimulatorStream,
  setSimulatorStreamOptions,
} from './stream-registry';
import {
  STREAM_CODEC_OPTIONS,
  STREAM_FPS_OPTIONS,
  STREAM_SCALE_OPTIONS,
  useSimulatorStreamSettings,
} from './stream-settings-store';

const BUSY_BANNER_MS = 3000;

/** Stable empty list, so the no-device case never re-keys the background-stream effect. */
const EMPTY_UDIDS: readonly string[] = [];

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

const FPS_ITEMS = STREAM_FPS_OPTIONS.map((n) => ({ value: String(n), label: `${n} FPS` }));
const SCALE_ITEMS = STREAM_SCALE_OPTIONS.map((n) => ({
  value: String(n),
  label: `${Math.round(n * 100)}%`,
}));
const CODEC_ITEMS = STREAM_CODEC_OPTIONS.map((c) => ({
  value: c,
  label: c === 'h264' ? 'H.264' : 'JPEG',
}));

/** Count frames arriving over `subscribeFrames` in one-second windows; `null` while disabled. State
 * updates at most once per second (not per frame), so the readout never drives the render loop. */
function useReceivedFps(
  subscribeFrames: (onFrame: (frame: SimulatorScreenFrame) => void) => () => void,
  enabled: boolean,
): number | null {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let count = 0;
    const unsubscribe = subscribeFrames(() => {
      count += 1;
    });
    const interval = setInterval(() => {
      setFps(count);
      count = 0;
    }, 1000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [subscribeFrames, enabled]);
  return enabled ? fps : null;
}

/** A compact "label value ⌄" dropdown for the stream-tuning row — quiet gray label, bold value.
 * The caller passes the already-formatted `display` for the current value (avoiding a render-phase
 * lookup); `items` is only the popup list. */
function QuietSelect({
  label,
  ariaLabel,
  display,
  value,
  items,
  onValueChange,
}: {
  label: string;
  ariaLabel: string;
  display: string;
  value: string;
  items: ReadonlyArray<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
}): React.ReactNode {
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className="flex items-center gap-1 rounded px-1 py-0.5 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{display}</span>
        <SelectPrimitive.Icon>
          <ChevronDownIcon className="size-3 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPopup>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

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
  // Open devices live in the store, not here: agent activity can open one before this component
  // ever mounts (CODE-418), and the cap is per thread, so the strip counts the way the host does.
  const sessionKey = simulatorSessionKey(sessionId);
  const tabs = useSimulatorPanelStore((state) => selectDeviceTabs(state, sessionKey));
  const openDevice = useSimulatorPanelStore((state) => state.openDevice);
  const closeDevice = useSimulatorPanelStore((state) => state.closeDevice);
  const selectDevice = useSimulatorPanelStore((state) => state.selectDevice);
  /** Screen-outline masks by udid as base64 PNGs; `null` = the host has none (generic rounding). */
  const [masks, setMasks] = useState<Readonly<Record<string, string | null>>>({});
  const [busy, setBusy] = useState(false);
  const busyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Shortcut owner: the chords below only fire while this panel is on screen. */
  const panelRef = useRef<HTMLDivElement | null>(null);
  const leaseRef = useRef<SimulatorStreamLease | null>(null);
  const rotateStateRef = useRef<{ udid: string | null; orientation: SimulatorOrientation }>({
    udid: null,
    orientation: 'portrait',
  });
  const { fps, scale, codec, showFps, setFps, setScale, setCodec, toggleShowFps } =
    useSimulatorStreamSettings();
  /** The live screen canvas, published by `SimulatorScreen` — the surface the recorder captures. */
  const [screenCanvas, setScreenCanvas] = useState<HTMLCanvasElement | null>(null);
  const recorder = useSimulatorRecorder();
  /** Devices the user detached: still booted, just not streamed here. Keyed so switching devices
   * (and back) remembers each one's state. */
  const [detached, setDetached] = useState<Readonly<Record<string, boolean>>>({});

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

  // Until the user opens a second device the panel shows one implicitly, so a fresh thread needs no
  // setup click. Opening another materializes that implicit tab first (see `addDevice`).
  const defaultUdid = pickDefaultDevice(devices)?.udid ?? null;
  const openUdids =
    tabs.udids.length > 0 ? tabs.udids : defaultUdid === null ? EMPTY_UDIDS : [defaultUdid];
  const activeUdid = tabs.activeUdid ?? defaultUdid;
  const device = devices?.find((item) => item.udid === activeUdid) ?? null;
  const udid = device?.udid ?? null;
  const booted = device?.state === 'Booted';
  // Optimistic until the probe resolves: assume interactive so a capable host streams immediately.
  // A host with simctl but no SimulatorKit reports `interactive: false`; the live stream would only
  // fail there, so we gate it out and show a hint instead of an unrecoverable Retry loop.
  const interactive = status?.interactive ?? true;
  const isDetached = udid !== null && (detached[udid] ?? false);
  const canStream = sessionId !== null && udid !== null && booted && interactive && !isDetached;

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
      if (sessionId === null || udid === null || !booted || isDetached) return noop;
      // Options are read from the store here (not a hook dep) so a tuning change retunes the running
      // stream via the effect below instead of tearing this subscription down and reacquiring.
      const settings = useSimulatorStreamSettings.getState();
      const lease = acquireSimulatorStream(client, udid, sessionId, {
        fps: settings.fps,
        scale: settings.scale,
        codec: settings.codec,
      });
      leaseRef.current = lease;
      const unsubscribe = lease.subscribe(onStoreChange);
      return () => {
        unsubscribe();
        lease.release();
        if (leaseRef.current === lease) leaseRef.current = null;
      };
    },
    [client, sessionId, udid, booted, isDetached],
  );
  const snapshot = useSyncExternalStore(subscribe, () =>
    canStream ? peekSimulatorStream(client, udid) : null,
  );
  /** The claim-holding session every interaction must ride. */
  const ownerSessionId = snapshot?.sessionId ?? null;

  // Push tuning changes onto the running stream (a stop→start restart inside the registry). Fires on
  // mount with the same options `subscribe` used, which the registry no-ops as unchanged.
  useEffect(() => {
    if (udid === null) return;
    setSimulatorStreamOptions(client, udid, { fps, scale, codec });
  }, [client, udid, fps, scale, codec]);

  // Every other open device keeps a low-rate stream so switching tabs is instant rather than a
  // reconnect, without four full-rate encodes running on the host.
  useBackgroundSimulatorStreams(
    client,
    sessionId,
    openUdids.filter((open) => open !== activeUdid),
    scale,
    codec,
  );

  const subscribeFrames = useCallback(
    (onFrame: (frame: SimulatorScreenFrame) => void) =>
      udid === null
        ? noop
        : client.subscribeSimulatorFrames(udid, (frame) =>
            onFrame({ codec: frame.codec, key: frame.key, data: frame.data }),
          ),
    [client, udid],
  );
  const measuredFps = useReceivedFps(subscribeFrames, showFps && canStream);
  const agentDriving = useSimulatorAgentActivity(client, udid);
  const consent = useSimulatorConsent(client);
  const consentRequest = useSimulatorConsentRequest(client);
  const agentAccess = udid === null ? undefined : consent.decisionFor(udid);
  /** Set while an agent is suspended on *this* device, waiting to be let in. */
  const consentPrompt =
    udid !== null && consentRequest?.udid === udid ? { udid, tool: consentRequest.tool } : null;

  const flagBusy = useCallback(() => {
    setBusy(true);
    clearTimeout(busyTimerRef.current);
    busyTimerRef.current = setTimeout(() => setBusy(false), BUSY_BANNER_MS);
  }, []);

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
  const pressButton = (button: SimulatorButton): void => {
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
  // The first device is shown implicitly (no tab was ever opened), so materialize it before adding
  // a second — otherwise opening one would replace what is on screen instead of joining it.
  const addDevice = (next: string): void => {
    if (defaultUdid !== null && tabs.udids.length === 0) openDevice(sessionKey, defaultUdid);
    openDevice(sessionKey, next);
  };
  const bootDevice = (): void => {
    if (sessionId === null || udid === null) return;
    // Booting is an explicit "I want this device here", so it also clears a stale detach.
    setDetached((prev) => ({ ...prev, [udid]: false }));
    void client.simulatorBoot(sessionId, udid).catch(flagBusy);
  };
  // Detach only stops streaming here — the device stays booted and keeps running whatever it was
  // doing, so an agent driving it is unaffected.
  const setAttached = (attached: boolean): void => {
    if (udid === null) return;
    setDetached((prev) => ({ ...prev, [udid]: !attached }));
  };
  const shutdownDevice = (): void => {
    if (sessionId === null || udid === null) return;
    void client.simulatorShutdown(sessionId, udid).catch(flagBusy);
  };
  // The screenshot comes from the device rather than the canvas: it is a real PNG at native
  // resolution, unaffected by the stream's scale/codec or the screen mask.
  const saveScreenshot = (): void => {
    if (ownerSessionId === null || udid === null || device === null) return;
    void client
      .simulatorScreenshot(ownerSessionId, udid, 'png')
      .then((shot) => {
        downloadBlob(
          base64Blob(shot.data, `image/${shot.format}`),
          `${captureFileStem(device.name)}.${shot.format}`,
        );
      })
      .catch(flagBusy);
  };
  // Simulator.app's chords, scoped to this panel (CODE-414). Declared before the availability
  // guard below because hooks must run unconditionally.
  useSimulatorShortcuts({
    owner: panelRef,
    enabled: ownerSessionId !== null && udid !== null,
    onButton: pressButton,
    onRotate: handleRotate,
  });

  if (status !== null && !status.available) {
    return <CenteredHint>{t('simulatorUnavailable')}</CenteredHint>;
  }

  const toggleRecording = (): void => {
    if (recorder.recording) {
      recorder.stop();
    } else if (screenCanvas !== null && device !== null) {
      recorder.start(screenCanvas, captureFileStem(device.name));
    }
  };

  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col">
      {openUdids.length > 0 && device !== null && (
        <div className="flex shrink-0 flex-col gap-1 border-border border-b px-2 py-1.5">
          <div className="flex items-center gap-2">
            <SimulatorDeviceTabs
              devices={devices ?? []}
              openUdids={openUdids}
              activeUdid={activeUdid}
              onSelect={(next) => selectDevice(sessionKey, next)}
              onClose={(next) => closeDevice(sessionKey, next)}
              onOpen={addDevice}
            />
            <div className="ml-auto flex shrink-0 items-center">
              {/* Agent access is a property of the device, so it sits with the device controls
                  rather than on the stage — reachable even when nothing is streaming. */}
              <Button
                variant="ghost"
                size="icon-sm"
                className={
                  agentAccess === 'granted' ? 'text-muted-foreground' : 'text-muted-foreground/60'
                }
                aria-label={
                  agentAccess === 'granted' ? t('simulatorAgentRevoke') : t('simulatorAgentAllow')
                }
                aria-pressed={agentAccess === 'granted'}
                onClick={() =>
                  udid !== null &&
                  consent.decide(udid, agentAccess === 'granted' ? 'denied' : 'granted')
                }
              >
                {agentAccess === 'granted' ? (
                  <BotIcon className="size-4" />
                ) : (
                  <BotOffIcon className="size-4" />
                )}
              </Button>
              {booted && sessionId !== null && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={t('simulatorShutdown')}
                  onClick={shutdownDevice}
                >
                  <PowerIcon className="size-4" />
                </Button>
              )}
            </div>
          </div>
          {canStream && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <QuietSelect
                label={t('simulatorFrameRate')}
                ariaLabel={t('simulatorFrameRate')}
                display={`${fps} FPS`}
                value={String(fps)}
                items={FPS_ITEMS}
                onValueChange={(next) => setFps(Number(next))}
              />
              <QuietSelect
                label={t('simulatorResolution')}
                ariaLabel={t('simulatorResolution')}
                display={`${Math.round(scale * 100)}%`}
                value={String(scale)}
                items={SCALE_ITEMS}
                onValueChange={(next) => setScale(Number(next))}
              />
              <QuietSelect
                label={t('simulatorEncoding')}
                ariaLabel={t('simulatorEncoding')}
                display={codec === 'h264' ? 'H.264' : 'JPEG'}
                value={codec}
                items={CODEC_ITEMS}
                onValueChange={(next) => setCodec(next === 'jpeg' ? 'jpeg' : 'h264')}
              />
              <label className="flex items-center gap-1.5 text-xs">
                <Checkbox checked={showFps} onCheckedChange={toggleShowFps} />
                <span className="text-muted-foreground">{t('simulatorFps')}</span>
                {showFps && <span className="font-medium tabular-nums">{measuredFps ?? '—'}</span>}
              </label>
            </div>
          )}
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
        {device !== null && booted && sessionId !== null && interactive && isDetached && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <span className="text-muted-foreground text-sm">{t('simulatorDetached')}</span>
            <Button variant="outline" size="sm" onClick={() => setAttached(true)}>
              {t('simulatorAttach')}
            </Button>
          </div>
        )}
        {canStream && (
          // The stage stays near-black in both themes (video-player convention) so the streamed
          // frame carries the contrast; everything on it uses fixed neutrals, not theme tokens.
          <div className="absolute inset-2 overflow-hidden rounded-lg bg-neutral-950">
            {agentDriving && (
              // Floats over the stage rather than displacing it, so the picture never shifts as an
              // agent starts and stops working. Input stays live — this informs, it does not lock.
              <div className="-translate-x-1/2 pointer-events-none absolute top-3 left-1/2 z-10 flex items-center gap-2 rounded-full bg-white px-3 py-1.5 font-medium text-neutral-900 text-xs shadow-lg">
                <span className="size-2 shrink-0 animate-pulse rounded-full bg-orange-500" />
                {t('simulatorAgentDriving')}
              </div>
            )}
            <SimulatorScreen
              key={udid}
              subscribeFrames={subscribeFrames}
              onTouch={handleTouch}
              onPinch={handlePinch}
              onKey={handleKey}
              onText={handleText}
              maskPng={masks[udid] ?? null}
              onScreenCanvas={setScreenCanvas}
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
                aria-label={t('simulatorScreenshot')}
                disabled={ownerSessionId === null}
                onClick={saveScreenshot}
              >
                <CameraIcon className="size-4" />
              </Button>
              {recorder.supported && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={
                    recorder.recording
                      ? 'text-red-400 hover:bg-white/10 hover:text-red-300'
                      : STAGE_BUTTON_CLASS
                  }
                  aria-label={
                    recorder.recording ? t('simulatorStopRecording') : t('simulatorRecord')
                  }
                  aria-pressed={recorder.recording}
                  disabled={ownerSessionId === null}
                  onClick={toggleRecording}
                >
                  {recorder.recording ? (
                    <CircleStopIcon className="size-4" />
                  ) : (
                    <VideoIcon className="size-4" />
                  )}
                </Button>
              )}
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
              <div className="mx-0.5 h-4 w-px bg-white/15" />
              <Button
                variant="ghost"
                size="icon-sm"
                className={STAGE_BUTTON_CLASS}
                aria-label={t('simulatorDetach')}
                onClick={() => setAttached(false)}
              >
                <UnplugIcon className="size-4" />
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
        {consentPrompt !== null && (
          // Over the whole panel, not the stage: an agent is blocked until this is answered, and
          // the device may not even be streaming yet (its first tool call is often the boot).
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/90 px-6 text-center">
            <span className="font-medium text-sm">{t('simulatorConsentTitle')}</span>
            <span className="text-muted-foreground text-xs">
              {t('simulatorConsentBody', { tool: consentPrompt.tool })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => consent.decide(consentPrompt.udid, 'denied')}
              >
                {t('simulatorConsentDeny')}
              </Button>
              <Button size="sm" onClick={() => consent.decide(consentPrompt.udid, 'granted')}>
                {t('simulatorConsentAllow')}
              </Button>
            </div>
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

/** The device a thread shows before it has opened any: a booted one if there is one. */
function pickDefaultDevice(devices: SimulatorDevice[] | null): SimulatorDevice | null {
  if (!devices || devices.length === 0) return null;
  return devices.find((item) => item.state === 'Booted') ?? devices[0];
}
