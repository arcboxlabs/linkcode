import type { Schedule, ScheduleRun, SessionId } from '@linkcode/schema';
import type { ScheduleReporter } from './schedule-reporter';
import type { ScheduleStore } from './schedule-store';
import type { SessionDriver } from './session-driver';

const SUMMARY_MAX_CHARS = 2000;

/** A run whose target no longer exists: the owning schedule can never fire again. */
export class ScheduleTargetGoneError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ScheduleTargetGoneError';
  }
}

export interface ScheduleRunOutcome {
  sessionId: SessionId;
  summary?: string;
}

/** Executes one schedule target while keeping its session link durable and observable. */
export class ScheduleRunExecutor {
  constructor(
    private readonly driver: SessionDriver,
    private readonly store: ScheduleStore,
    private readonly reporter: ScheduleReporter,
  ) {}

  async execute(schedule: Schedule, run: ScheduleRun): Promise<ScheduleRunOutcome> {
    const target = schedule.spec.target;
    if (target.type === 'session') {
      if (!this.driver.hasRecord(target.sessionId)) {
        throw new ScheduleTargetGoneError(`target session no longer exists: ${target.sessionId}`);
      }
      if (this.driver.isBusy(target.sessionId)) throw new Error('session busy');
      await this.driver.ensureLive(target.sessionId);
      await this.linkSession(run, target.sessionId);
      const result = await this.driver.prompt(target.sessionId, schedule.spec.prompt);
      return { sessionId: target.sessionId, summary: summarize(result.text) };
    }

    const sessionId = await this.driver.createSession({
      kind: target.config.kind,
      cwd: target.config.cwd,
      model: target.config.model,
      title: schedule.spec.name ?? 'Scheduled run',
      automation: { kind: 'schedule', id: schedule.scheduleId },
    });
    await this.linkSession(run, sessionId);
    try {
      await this.driver.makeUnattended(sessionId);
      const result = await this.driver.prompt(sessionId, schedule.spec.prompt);
      return { sessionId, summary: summarize(result.text) };
    } finally {
      // The record is kept (hidden from Threads); the run's summary is the durable output.
      await this.driver.stopSession(sessionId);
    }
  }

  private async linkSession(run: ScheduleRun, sessionId: SessionId): Promise<void> {
    run.sessionId = sessionId;
    await this.store.saveRun(run);
    this.reporter.runChanged(run);
  }
}

function summarize(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > SUMMARY_MAX_CHARS ? trimmed.slice(0, SUMMARY_MAX_CHARS) : trimmed;
}
