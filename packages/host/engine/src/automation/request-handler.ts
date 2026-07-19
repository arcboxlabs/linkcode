import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
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

  handle(payload: AutomationRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'schedule.create':
        return this.responder.reply(
          payload.clientReqId,
          this.scheduler.create(payload.spec).pipe(
            Effect.flatMap((schedule) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'schedule.created',
                    replyTo: payload.clientReqId,
                    schedule,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'schedule.update':
        return this.responder.reply(
          payload.clientReqId,
          this.scheduler.update(payload.scheduleId, payload.patch).pipe(
            Effect.flatMap((schedule) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'schedule.updated',
                    replyTo: payload.clientReqId,
                    schedule,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'schedule.delete':
        return this.responder.reply(
          payload.clientReqId,
          fromPromise(() => this.scheduler.delete(payload.scheduleId)).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      case 'schedule.pause':
        return this.responder.reply(
          payload.clientReqId,
          fromPromise(() => this.scheduler.pause(payload.scheduleId)).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      case 'schedule.resume':
        return this.responder.reply(
          payload.clientReqId,
          fromPromise(() => this.scheduler.resume(payload.scheduleId)).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      case 'schedule.run-once':
        return this.responder.reply(
          payload.clientReqId,
          fromSync(() => this.scheduler.runOnce(payload.scheduleId)).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      case 'schedule.list':
        return Effect.sync(() =>
          this.transport.send(
            createWireMessage({
              kind: 'schedule.listed',
              replyTo: payload.clientReqId,
              schedules: this.scheduler.list(),
            }),
          ),
        );
      case 'schedule.runs.list':
        return this.responder.reply(
          payload.clientReqId,
          fromPromise(() => this.scheduler.listRuns(payload.scheduleId, payload.limit)).pipe(
            Effect.flatMap((runs) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'schedule.runs.listed',
                    replyTo: payload.clientReqId,
                    runs,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'loop.start':
        return this.responder.reply(
          payload.clientReqId,
          fromPromise(() => this.loops.startLoop(payload.spec)).pipe(
            Effect.flatMap((loop) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({ kind: 'loop.started', replyTo: payload.clientReqId, loop }),
                ),
              ),
            ),
          ),
        );
      case 'loop.stop':
        return this.responder.reply(
          payload.clientReqId,
          fromSync(() => this.loops.stopLoop(payload.loopId)).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      case 'loop.delete':
        return this.responder.reply(
          payload.clientReqId,
          fromPromise(() => this.loops.deleteLoop(payload.loopId)).pipe(
            Effect.andThen(Effect.sync(() => this.responder.sendSuccess(payload.clientReqId))),
          ),
        );
      case 'loop.list':
        return Effect.sync(() =>
          this.transport.send(
            createWireMessage({
              kind: 'loop.listed',
              replyTo: payload.clientReqId,
              loops: this.loops.list(),
            }),
          ),
        );
      case 'loop.inspect':
        return this.responder.reply(
          payload.clientReqId,
          fromPromise(() => this.loops.inspect(payload.loopId)).pipe(
            Effect.flatMap(({ loop, iterations, logs }) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'loop.inspected',
                    replyTo: payload.clientReqId,
                    loop,
                    iterations,
                    logs,
                  }),
                ),
              ),
            ),
          ),
        );
      default:
        return Effect.void;
    }
  }
}

function fromPromise<A>(run: () => PromiseLike<A>): Effect.Effect<A, unknown> {
  return Effect.tryPromise({ try: () => run(), catch: (cause) => cause });
}

function fromSync<A>(run: () => A): Effect.Effect<A, unknown> {
  return Effect.try({ try: run, catch: (cause) => cause });
}
