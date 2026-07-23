import type { WirePayload } from '@linkcode/schema';
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
      | 'simulator.screenshot';
  }
>;

/**
 * Translates inbound simulator wire requests into operations on the optional simulator service.
 * Ownership, caps, and reclaim all live in the service; this layer only correlates replies and
 * broadcasts a fresh device list after state-changing commands (the engine has no CoreSimulator
 * watcher, so its own commands are the only change source it can observe).
 */
export class SimulatorRequestHandler {
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
      default:
        return Effect.void;
    }
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
