import type { Schedule, ScheduleId, ScheduleRun } from '@linkcode/schema';

/**
 * Durable storage for schedules and their run history. The daemon injects a SQLite-backed
 * implementation; the in-memory default keeps bare engines and tests dependency-free. Schedules are
 * whole-record upserts; runs grow unbounded, so the service prunes them per schedule.
 */
export interface ScheduleStore {
  load(): Promise<Schedule[]>;
  save(schedule: Schedule): Promise<void>;
  /** Delete a schedule and cascade its runs. */
  delete(scheduleId: ScheduleId): Promise<void>;
  /** Newest-first run history for one schedule. */
  loadRuns(scheduleId: ScheduleId, limit?: number): Promise<ScheduleRun[]>;
  /** Every run still marked `running` — the boot sweep marks these interrupted. */
  loadRunningRuns(): Promise<ScheduleRun[]>;
  /** Upsert a run by `runId`. */
  saveRun(run: ScheduleRun): Promise<void>;
  /** Keep only the newest `keep` runs of a schedule. */
  pruneRuns(scheduleId: ScheduleId, keep: number): Promise<void>;
}

export class InMemoryScheduleStore implements ScheduleStore {
  private readonly schedules = new Map<ScheduleId, Schedule>();
  private readonly runs = new Map<string, ScheduleRun>();

  load(): Promise<Schedule[]> {
    return Promise.resolve([...this.schedules.values()].map((s) => structuredClone(s)));
  }

  save(schedule: Schedule): Promise<void> {
    this.schedules.set(schedule.scheduleId, structuredClone(schedule));
    return Promise.resolve();
  }

  delete(scheduleId: ScheduleId): Promise<void> {
    this.schedules.delete(scheduleId);
    for (const [runId, run] of this.runs) {
      if (run.scheduleId === scheduleId) this.runs.delete(runId);
    }
    return Promise.resolve();
  }

  loadRuns(scheduleId: ScheduleId, limit?: number): Promise<ScheduleRun[]> {
    const runs = this.runsForSchedule(scheduleId);
    runs.sort((a, b) => b.startedAt - a.startedAt);
    return Promise.resolve(limit === undefined ? runs : runs.slice(0, limit));
  }

  loadRunningRuns(): Promise<ScheduleRun[]> {
    const running: ScheduleRun[] = [];
    for (const run of this.runs.values()) {
      if (run.status === 'running') running.push(structuredClone(run));
    }
    return Promise.resolve(running);
  }

  private runsForSchedule(scheduleId: ScheduleId): ScheduleRun[] {
    const runs: ScheduleRun[] = [];
    for (const run of this.runs.values()) {
      if (run.scheduleId === scheduleId) runs.push(structuredClone(run));
    }
    return runs;
  }

  saveRun(run: ScheduleRun): Promise<void> {
    this.runs.set(run.runId, structuredClone(run));
    return Promise.resolve();
  }

  pruneRuns(scheduleId: ScheduleId, keep: number): Promise<void> {
    const runs = this.runsForSchedule(scheduleId);
    runs.sort((a, b) => b.startedAt - a.startedAt);
    for (const run of runs.slice(keep)) this.runs.delete(run.runId);
    return Promise.resolve();
  }
}
