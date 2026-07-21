import type { ScheduleCadence } from '@linkcode/schema';

/** Human cadence summary shared by the schedule list rows and detail facts. */
export function cadenceLabel(
  cadence: ScheduleCadence,
  t: (key: string, values?: Record<string, number>) => string,
): string {
  if (cadence.type === 'interval') {
    return t('schedule.everyMinutes', { minutes: Math.round(cadence.everyMs / 60_000) });
  }
  return cadence.timezone ? `${cadence.expression} (${cadence.timezone})` : cadence.expression;
}
