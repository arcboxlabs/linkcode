import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import type { WireResponder } from '../wire/responder';
import type { LoopService } from './loop-service';
import type { ScheduleService } from './schedule-service';

type AutomationRequest = Extract<
  WirePayload,
  {
    kind:
      | 'schedule.create'
      | 'schedule.update'
      | 'schedule.delete'
      | 'schedule.pause'
      | 'schedule.resume'
      | 'schedule.run-once'
      | 'schedule.list'
      | 'schedule.runs.list'
      | 'loop.start'
      | 'loop.stop'
      | 'loop.delete'
      | 'loop.list'
      | 'loop.inspect';
  }
>;

/** Translates schedule and loop wire requests into automation service operations. */
export class AutomationRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly scheduler: ScheduleService,
    private readonly loops: LoopService,
    private readonly responder: WireResponder,
  ) {}

  async handle(payload: AutomationRequest): Promise<void> {
    switch (payload.kind) {
      case 'schedule.create':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const schedule = await this.scheduler.create(payload.spec);
          this.transport.send(
            createWireMessage({
              kind: 'schedule.created',
              replyTo: payload.clientReqId,
              schedule,
            }),
          );
        });
        break;
      case 'schedule.update':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const schedule = await this.scheduler.update(payload.scheduleId, payload.patch);
          this.transport.send(
            createWireMessage({
              kind: 'schedule.updated',
              replyTo: payload.clientReqId,
              schedule,
            }),
          );
        });
        break;
      case 'schedule.delete':
        await this.responder.tryReply(payload.clientReqId, async () => {
          await this.scheduler.delete(payload.scheduleId);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      case 'schedule.pause':
        await this.responder.tryReply(payload.clientReqId, async () => {
          await this.scheduler.pause(payload.scheduleId);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      case 'schedule.resume':
        await this.responder.tryReply(payload.clientReqId, async () => {
          await this.scheduler.resume(payload.scheduleId);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      case 'schedule.run-once':
        await this.responder.tryReply(payload.clientReqId, () => {
          this.scheduler.runOnce(payload.scheduleId);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      case 'schedule.list':
        this.transport.send(
          createWireMessage({
            kind: 'schedule.listed',
            replyTo: payload.clientReqId,
            schedules: this.scheduler.list(),
          }),
        );
        break;
      case 'schedule.runs.list':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const runs = await this.scheduler.listRuns(payload.scheduleId, payload.limit);
          this.transport.send(
            createWireMessage({
              kind: 'schedule.runs.listed',
              replyTo: payload.clientReqId,
              runs,
            }),
          );
        });
        break;
      case 'loop.start':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const loop = await this.loops.startLoop(payload.spec);
          this.transport.send(
            createWireMessage({ kind: 'loop.started', replyTo: payload.clientReqId, loop }),
          );
        });
        break;
      case 'loop.stop':
        await this.responder.tryReply(payload.clientReqId, () => {
          this.loops.stopLoop(payload.loopId);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      case 'loop.delete':
        await this.responder.tryReply(payload.clientReqId, async () => {
          await this.loops.deleteLoop(payload.loopId);
          this.responder.sendSuccess(payload.clientReqId);
        });
        break;
      case 'loop.list':
        this.transport.send(
          createWireMessage({
            kind: 'loop.listed',
            replyTo: payload.clientReqId,
            loops: this.loops.list(),
          }),
        );
        break;
      case 'loop.inspect':
        await this.responder.tryReply(payload.clientReqId, async () => {
          const { loop, iterations, logs } = await this.loops.inspect(payload.loopId);
          this.transport.send(
            createWireMessage({
              kind: 'loop.inspected',
              replyTo: payload.clientReqId,
              loop,
              iterations,
              logs,
            }),
          );
        });
        break;
      default:
        break;
    }
  }
}
