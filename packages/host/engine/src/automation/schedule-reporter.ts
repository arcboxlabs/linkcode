import type { Schedule, ScheduleId, ScheduleRun } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';

/** Projects durable schedule and run state changes onto the wire. */
export class ScheduleReporter {
  constructor(private readonly transport: Transport) {}

  changed(schedule: Schedule): void {
    this.transport.send(createWireMessage({ kind: 'schedule.changed', schedule }));
  }

  removed(scheduleId: ScheduleId): void {
    this.transport.send(createWireMessage({ kind: 'schedule.removed', scheduleId }));
  }

  runChanged(run: ScheduleRun): void {
    this.transport.send(createWireMessage({ kind: 'schedule.run', run }));
  }
}
