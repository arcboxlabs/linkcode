import { describe, expect, it } from 'vitest';
import type { MessageId } from '../../common';
import type { Schedule, ScheduleRun, ScheduleSpec } from '../../schedule';
import type { WirePayload } from '../index';
import { parseWireMessage, WIRE_PROTOCOL_VERSION } from '../index';

function envelope(payload: WirePayload) {
  return { v: WIRE_PROTOCOL_VERSION, id: 'msg-1' as MessageId, ts: 0, payload };
}

const spec: ScheduleSpec = {
  prompt: 'summarize open PRs',
  cadence: { type: 'cron', expression: '0 9 * * 1-5', timezone: 'Asia/Shanghai' },
  target: { type: 'new-session', config: { kind: 'claude-code', cwd: '/repo' } },
};

const schedule: Schedule = {
  scheduleId: 'sch-1' as Schedule['scheduleId'],
  spec,
  status: 'active',
  nextRunAt: 1000,
  runCount: 0,
  createdAt: 0,
  updatedAt: 0,
};

const run: ScheduleRun = {
  runId: 'run-1' as ScheduleRun['runId'],
  scheduleId: 'sch-1' as ScheduleRun['scheduleId'],
  status: 'running',
  trigger: 'cadence',
  startedAt: 0,
};

describe('schedule wire variants', () => {
  it('round-trips every request/reply/broadcast kind', () => {
    const payloads: WirePayload[] = [
      { kind: 'schedule.create', clientReqId: 'c1', spec },
      { kind: 'schedule.created', replyTo: 'c1', schedule },
      {
        kind: 'schedule.update',
        clientReqId: 'c2',
        scheduleId: schedule.scheduleId,
        patch: { name: 'x' },
      },
      { kind: 'schedule.updated', replyTo: 'c2', schedule },
      { kind: 'schedule.delete', clientReqId: 'c3', scheduleId: schedule.scheduleId },
      { kind: 'schedule.pause', clientReqId: 'c4', scheduleId: schedule.scheduleId },
      { kind: 'schedule.resume', clientReqId: 'c5', scheduleId: schedule.scheduleId },
      { kind: 'schedule.run-once', clientReqId: 'c6', scheduleId: schedule.scheduleId },
      { kind: 'schedule.list', clientReqId: 'c7' },
      { kind: 'schedule.listed', replyTo: 'c7', schedules: [schedule] },
      { kind: 'schedule.runs.list', clientReqId: 'c8', scheduleId: schedule.scheduleId, limit: 50 },
      { kind: 'schedule.runs.listed', replyTo: 'c8', runs: [run] },
      { kind: 'schedule.changed', schedule },
      { kind: 'schedule.removed', scheduleId: schedule.scheduleId },
      { kind: 'schedule.run', run },
    ];
    for (const payload of payloads) {
      expect(parseWireMessage(envelope(payload)).success, payload.kind).toBe(true);
    }
  });

  it('rejects a sub-minute interval cadence', () => {
    const payload: WirePayload = {
      kind: 'schedule.create',
      clientReqId: 'c1',
      spec: { ...spec, cadence: { type: 'interval', everyMs: 1000 } },
    };
    expect(parseWireMessage(envelope(payload)).success).toBe(false);
  });
});
