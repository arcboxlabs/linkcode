import type { ScheduleCadence } from '@linkcode/schema';
import { Cron } from 'croner';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export class ScheduleCadenceCalculator {
  constructor(private readonly now: () => number) {}

  /** Throws on an invalid cron expression or time zone. */
  validate(cadence: ScheduleCadence): void {
    if (cadence.type === 'cron') this.buildCron(cadence);
  }

  /** The first occurrence strictly after `from`. */
  next(cadence: ScheduleCadence, from: number): number {
    if (cadence.type === 'interval') return from + cadence.everyMs;
    const next = this.buildCron(cadence).nextRun(new Date(from));
    // A cron with no future occurrence (never for a 5-field pattern) parks a period ahead.
    return next ? next.getTime() : from + TWELVE_HOURS_MS;
  }

  /** The last occurrence at or before `now`, walking forward from the earliest missed `from`. */
  latestAtOrBefore(cadence: ScheduleCadence, from: number, now: number): number {
    if (cadence.type === 'interval') {
      if (now <= from) return from;
      const steps = Math.floor((now - from) / cadence.everyMs);
      return from + steps * cadence.everyMs;
    }
    let current = from;
    for (let guard = 0; guard < 1_000_000; guard += 1) {
      const next = this.next(cadence, current);
      if (next > now) break;
      current = next;
    }
    return current;
  }

  graceMs(cadence: ScheduleCadence): number {
    if (cadence.type === 'interval') return Math.min(cadence.everyMs, TWELVE_HOURS_MS);
    // The current period is the gap between the next two occurrences.
    const first = this.next(cadence, this.now());
    const second = this.next(cadence, first);
    return Math.min(second - first, TWELVE_HOURS_MS);
  }

  private buildCron(cadence: Extract<ScheduleCadence, { type: 'cron' }>): Cron {
    return new Cron(cadence.expression, cadence.timezone ? { timezone: cadence.timezone } : {});
  }
}
