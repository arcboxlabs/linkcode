import type { SessionId, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { EngineFailure } from '../failure';
import { RequestError, toOperationFailure } from '../failure';
import type { WireResponder } from '../wire/responder';
import type { SimulatorService } from './service';

type SimulatorRequest = Extract<
  WirePayload,
  {
    kind:
      | 'simulator.status'
      | 'simulator.list'
      | 'simulator.boot'
      | 'simulator.shutdown'
      | 'simulator.install'
      | 'simulator.launch'
      | 'simulator.terminate'
      | 'simulator.open-url'
      | 'simulator.screenshot'
      | 'simulator.screen-mask'
      | 'simulator.tap'
      | 'simulator.touch'
      | 'simulator.swipe'
      | 'simulator.button'
      | 'simulator.key'
      | 'simulator.stream.start'
      | 'simulator.stream.stop';
  }
>;

/**
 * Translates inbound simulator wire requests into operations on the optional simulator service.
 * Ownership, caps, and reclaim all live in the service; this layer only correlates replies and
 * broadcasts a fresh device list after state-changing commands (the engine has no CoreSimulator
 * watcher, so its own commands are the only change source it can observe).
 */
export class SimulatorRequestHandler {
  /** Active framebuffer fan-out subscriptions, keyed by udid; the value unsubscribes it. */
  private readonly frameSubs = new Map<string, () => void>();

  constructor(
    private readonly simulators: SimulatorService | undefined,
    private readonly transport: Transport,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: SimulatorRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'simulator.status':
        // Answered even without a backend: `available: false` IS the capability signal clients
        // gate their UI on, so it must never surface as an error.
        return this.responder.reply(
          payload.clientReqId,
          simulatorOperation('simulator.status', 'Failed to probe simulators', async () => {
            const status = this.simulators
              ? await this.simulators.status()
              : { available: false, reason: 'simulators are unavailable on this host' };
            this.transport.send(
              createWireMessage({
                kind: 'simulator.status.result',
                replyTo: payload.clientReqId,
                status,
              }),
            );
          }),
        );
      case 'simulator.list':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.list', 'Failed to list simulators', async () => {
            const devices = await simulators.list();
            this.transport.send(
              createWireMessage({
                kind: 'simulator.listed',
                replyTo: payload.clientReqId,
                devices,
              }),
            );
          }),
        );
      case 'simulator.boot':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.boot', 'Failed to boot simulator', async () => {
            await simulators.boot(payload.sessionId, payload.udid);
            this.responder.sendSuccess(payload.clientReqId);
            await this.broadcastDevices(simulators);
          }),
        );
      case 'simulator.shutdown':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.shutdown', 'Failed to shut simulator down', async () => {
            await simulators.shutdownDevice(payload.sessionId, payload.udid);
            this.responder.sendSuccess(payload.clientReqId);
            await this.broadcastDevices(simulators);
          }),
        );
      case 'simulator.install':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.install', 'Failed to install app', async () => {
            await simulators.install(payload.sessionId, payload.udid, payload.appPath);
            this.responder.sendSuccess(payload.clientReqId);
          }),
        );
      case 'simulator.launch':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.launch', 'Failed to launch app', async () => {
            const pid = await simulators.launch(payload.sessionId, payload.udid, payload.bundleId);
            this.transport.send(
              createWireMessage({
                kind: 'simulator.launched',
                replyTo: payload.clientReqId,
                pid,
              }),
            );
          }),
        );
      case 'simulator.terminate':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.terminate', 'Failed to terminate app', async () => {
            await simulators.terminate(payload.sessionId, payload.udid, payload.bundleId);
            this.responder.sendSuccess(payload.clientReqId);
          }),
        );
      case 'simulator.open-url':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.open-url', 'Failed to open URL', async () => {
            await simulators.openUrl(payload.sessionId, payload.udid, payload.url);
            this.responder.sendSuccess(payload.clientReqId);
          }),
        );
      case 'simulator.screenshot':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.screenshot', 'Failed to capture screenshot', async () => {
            const format = payload.format ?? 'jpeg';
            const image = await simulators.screenshot(payload.sessionId, payload.udid, format);
            this.transport.send(
              createWireMessage({
                kind: 'simulator.screenshotted',
                replyTo: payload.clientReqId,
                format,
                data: Buffer.from(image).toString('base64'),
              }),
            );
          }),
        );
      case 'simulator.screen-mask':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.screen-mask', 'Failed to load screen mask', async () => {
            const mask = await simulators.screenMask(payload.udid);
            this.transport.send(
              createWireMessage({
                kind: 'simulator.screen-masked',
                replyTo: payload.clientReqId,
                data: Buffer.from(mask).toString('base64'),
              }),
            );
          }),
        );
      case 'simulator.tap':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.tap', 'Failed to tap', async () => {
            await simulators.tap(payload.sessionId, payload.udid, payload.x, payload.y);
            this.responder.sendSuccess(payload.clientReqId);
          }),
        );
      case 'simulator.touch':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.touch', 'Failed to inject touch', async () => {
            await simulators.touch(
              payload.sessionId,
              payload.udid,
              payload.phase,
              payload.x,
              payload.y,
            );
            this.responder.sendSuccess(payload.clientReqId);
          }),
        );
      case 'simulator.swipe':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.swipe', 'Failed to swipe', async () => {
            await simulators.swipe(
              payload.sessionId,
              payload.udid,
              { x: payload.x0, y: payload.y0 },
              { x: payload.x1, y: payload.y1 },
              payload.durationMs,
            );
            this.responder.sendSuccess(payload.clientReqId);
          }),
        );
      case 'simulator.button':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.button', 'Failed to press button', async () => {
            await simulators.button(payload.sessionId, payload.udid, payload.button);
            this.responder.sendSuccess(payload.clientReqId);
          }),
        );
      case 'simulator.key':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.key', 'Failed to press key', async () => {
            await simulators.key(payload.sessionId, payload.udid, payload.usage, payload.modifiers);
            this.responder.sendSuccess(payload.clientReqId);
          }),
        );
      case 'simulator.stream.start':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.stream.start', 'Failed to start stream', async () => {
            const result = await simulators.streamStart(payload.sessionId, payload.udid, {
              fps: payload.fps,
              quality: payload.quality,
              scale: payload.scale,
              codec: payload.codec,
            });
            this.subscribeFrames(simulators, payload.sessionId, payload.udid);
            // `alreadyStreaming` carries no params, so echo the request's (defaulted) values.
            const fps = 'streaming' in result ? result.fps : (payload.fps ?? 60);
            const scale = 'streaming' in result ? result.scale : (payload.scale ?? 1);
            const codec = 'streaming' in result ? result.codec : (payload.codec ?? 'jpeg');
            this.transport.send(
              createWireMessage({
                kind: 'simulator.stream.started',
                replyTo: payload.clientReqId,
                udid: payload.udid,
                fps,
                scale,
                codec,
              }),
            );
          }),
        );
      case 'simulator.stream.stop':
        return this.withSimulators(payload.clientReqId, (simulators) =>
          simulatorOperation('simulator.stream.stop', 'Failed to stop stream', async () => {
            this.unsubscribeFrames(payload.udid);
            await simulators.streamStop(payload.sessionId, payload.udid);
            this.responder.sendSuccess(payload.clientReqId);
          }),
        );
      default:
        return Effect.void;
    }
  }

  /** Fan the device's frames out to the transport as session-scoped `simulator.stream.frame`s.
   * Idempotent: a second `streamStart` for a device already fanning out keeps the one subscription. */
  private subscribeFrames(simulators: SimulatorService, sessionId: SessionId, udid: string): void {
    if (this.frameSubs.has(udid)) return;
    const unsubscribe = simulators.onFrame(udid, (frame) => {
      this.transport.send(
        createWireMessage({
          kind: 'simulator.stream.frame',
          sessionId,
          udid,
          codec: frame.codec,
          key: frame.key,
          data: Buffer.from(frame.data).toString('base64'),
        }),
      );
    });
    this.frameSubs.set(udid, unsubscribe);
  }

  private unsubscribeFrames(udid: string): void {
    this.frameSubs.get(udid)?.();
    this.frameSubs.delete(udid);
  }

  /** Best-effort push after a state-changing command; the command itself already succeeded. */
  private async broadcastDevices(simulators: SimulatorService): Promise<void> {
    try {
      const devices = await simulators.list();
      this.transport.send(createWireMessage({ kind: 'simulator.devices.changed', devices }));
    } catch {
      // The next explicit list will reconcile; failing the completed command would be worse.
    }
  }

  private withSimulators(
    replyTo: string,
    fn: (simulators: SimulatorService) => Effect.Effect<void, EngineFailure>,
  ): Effect.Effect<void> {
    const operation = this.simulators
      ? fn(this.simulators)
      : Effect.fail(
          new RequestError({
            code: 'unsupported',
            message: 'Simulators are not supported on this host',
          }),
        );
    return this.responder.reply(replyTo, operation);
  }
}

function simulatorOperation(
  operation: string,
  publicMessage: string,
  run: () => Promise<void>,
): Effect.Effect<void, EngineFailure> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      toOperationFailure(cause, { subsystem: 'simulator', operation, publicMessage }),
  });
}
