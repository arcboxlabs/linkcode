import type { ScheduleCadence } from '@linkcode/schema';
import { recognizePreset } from './form-model';

/** Human cadence summary shared by the schedule list rows and detail facts. */
export function cadenceLabel(
  cadence: ScheduleCadence,
  t: (key: string, values?: Record<string, number>) => string,
): string {
  if (cadence.type === 'interval') {
    return t('schedule.everyMinutes', { minutes: cadence.everyMs / 60000 });
  }
  const preset = recognizePreset(cadence.expression);
  let label = cadence.expression;
  if (preset.cadenceKind) {
    const time = `${String(preset.hour ?? 0).padStart(2, '0')}:${String(preset.minute ?? 0).padStart(2, '0')}`;
    label =
      preset.cadenceKind === 'hourly'
        ? `${t('schedule.hourly')} · :${String(preset.minute ?? 0).padStart(2, '0')}`
        : `${t(`schedule.${preset.cadenceKind}`)} · ${time}`;
    if (preset.weekdays && preset.weekdays.length > 0) {
      const weekdaySeparator = t('schedule.weekdaySeparator');
      label += ` · ${preset.weekdays.map((day) => t(`schedule.weekdayNames.${day}`)).join(weekdaySeparator)}`;
    }
    if (preset.monthDay !== undefined) {
      label += ` · ${t('schedule.onDay', { day: preset.monthDay })}`;
    }
  }
  return cadence.timezone ? `${label} (${cadence.timezone})` : label;
}
