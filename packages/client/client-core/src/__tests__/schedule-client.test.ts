import type { Schedule, ScheduleId, ScheduleRun, WirePayload } from '@linkcode/schema';
import { createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import type { ScheduleEvent } from '../client';
import { createConnectedLocalClient } from './local-client';

const schedule: Schedule = {
  scheduleId: 'sch-1' as ScheduleId,
  spec: {
    prompt: 'summarize',
    cadence: { type: 'interval', everyMs: 60_000 },
    target: { type: 'new-session', config: { kind: 'claude-code', cwd: '/repo' } },
  },
  status: 'active',
  nextRunAt: 1000,
  runCount: 0,
  createdAt: 0,
  updatedAt: 0,
};

const run: ScheduleRun = {
  runId: 'run-1' as ScheduleRun['runId'],
  scheduleId: 'sch-1' as ScheduleId,
  status: 'running',
  trigger: 'cadence',
  startedAt: 0,
};

describe('LinkCodeClient schedule API', () => {
  it('correlates create/list/runs replies and acks mutations', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    serverTransport.onMessage((msg) => {
      const p = msg.payload;
      const reply = ((): WirePayload | undefined => {
        switch (p.kind) {
          case 'schedule.create':
            return { kind: 'schedule.created', replyTo: p.clientReqId, schedule };
          case 'schedule.list':
            return { kind: 'schedule.listed', replyTo: p.clientReqId, schedules: [schedule] };
          case 'schedule.runs.list':
            return { kind: 'schedule.runs.listed', replyTo: p.clientReqId, runs: [run] };
          case 'schedule.pause':
          case 'schedule.delete':
            return { kind: 'request.succeeded', replyTo: p.clientReqId };
          default:
            return undefined;
        }
      })();
      if (reply) serverTransport.send(createWireMessage(reply));
    });

    await expect(client.createSchedule(schedule.spec)).resolves.toEqual(schedule);
    await expect(client.listSchedules()).resolves.toEqual([schedule]);
    await expect(client.listScheduleRuns(schedule.scheduleId)).resolves.toEqual([run]);
    await expect(client.pauseSchedule(schedule.scheduleId)).resolves.toEqual({ ok: true });
    await expect(client.deleteSchedule(schedule.scheduleId)).resolves.toEqual({ ok: true });

    client.dispose();
    serverTransport.close();
  });

  it('fans schedule broadcasts out until unsubscribed', async () => {
    const { client, serverTransport } = await createConnectedLocalClient();
    const events: ScheduleEvent[] = [];
    const unsubscribe = client.subscribeScheduleEvents((event) => events.push(event));

    const send = (payload: WirePayload) => serverTransport.send(createWireMessage(payload));
    send({ kind: 'schedule.changed', schedule });
    send({ kind: 'schedule.run', run });
    await Promise.resolve();
    await Promise.resolve();
    unsubscribe();
    send({ kind: 'schedule.removed', scheduleId: schedule.scheduleId });
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      { type: 'changed', schedule },
      { type: 'run', run },
    ]);

    client.dispose();
    serverTransport.close();
  });
});
