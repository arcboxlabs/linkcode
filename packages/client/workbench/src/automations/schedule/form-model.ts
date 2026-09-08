import type { Schedule, ScheduleSpec, ScheduleUpdate } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { z } from 'zod';

const RE_INTEGER = /^\d+$/;
const RE_WEEKDAY = /^[0-6]$/;

export const scheduleFormSchema = z
  .object({
    name: z.string().trim(),
    prompt: z.string().trim().min(1),
    kind: AgentKindSchema,
    cwd: z.string().trim(),
    targetSession: z.string(),
    cadenceKind: z.enum(['hourly', 'daily', 'weekdays', 'weekly', 'monthly', 'interval', 'cron']),
    intervalMinutes: z.number().or(z.nan()),
    hour: z.number().or(z.nan()),
    minute: z.number().or(z.nan()),
    weekday: z.number().or(z.nan()),
    monthDay: z.number().or(z.nan()),
    cronExpression: z.string().trim(),
    timezone: z.string().trim(),
    maxRuns: z.string().regex(/^$|^[1-9]\d*$/),
    expiresAt: z.string(),
    misfire: z.enum(['default', 'skip', 'catch-up']),
  })
  .superRefine((draft, ctx) => {
    const check = (
      field: 'intervalMinutes' | 'hour' | 'minute' | 'weekday' | 'monthDay',
      min: number,
      max: number,
    ): void => {
      const schema =
        field === 'intervalMinutes'
          ? z.number().min(min).max(max)
          : z.number().int().min(min).max(max);
      const result = schema.safeParse(draft[field]);
      if (!result.success) {
        for (let i = 0, len = result.error.issues.length; i < len; i++) {
          const issue = result.error.issues[i];
          ctx.addIssue({ ...issue, path: [field] });
        }
      }
    };
    if (draft.cadenceKind === 'interval') {
      check('intervalMinutes', 1, Number.MAX_SAFE_INTEGER / 60000);
    } else if (draft.cadenceKind !== 'cron') {
      check('minute', 0, 59);
      if (draft.cadenceKind !== 'hourly') check('hour', 0, 23);
      if (draft.cadenceKind === 'weekly') check('weekday', 0, 6);
      if (draft.cadenceKind === 'monthly') check('monthDay', 1, 31);
    }
    if (!draft.targetSession && !draft.cwd) {
      ctx.addIssue({ code: 'custom', path: ['cwd'], message: 'required' });
    }
    if (draft.cadenceKind === 'cron' && !draft.cronExpression) {
      ctx.addIssue({ code: 'custom', path: ['cronExpression'], message: 'required' });
    }
    if (draft.expiresAt && !Number.isFinite(Date.parse(draft.expiresAt))) {
      ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Invalid date' });
    }
  });
export type ScheduleFormDraft = z.infer<typeof scheduleFormSchema>;

export function scheduleDraft(schedule?: Schedule): ScheduleFormDraft {
  const cadence = schedule?.spec.cadence;
  const config =
    schedule?.spec.target.type === 'new-session' ? schedule.spec.target.config : undefined;
  return {
    name: schedule?.spec.name ?? '',
    prompt: schedule?.spec.prompt ?? '',
    kind: config?.kind ?? 'claude-code',
    cwd: config?.cwd ?? '',
    targetSession: schedule?.spec.target.type === 'session' ? schedule.spec.target.sessionId : '',
    cadenceKind: cadence?.type ?? 'daily',
    intervalMinutes: cadence?.type === 'interval' ? cadence.everyMs / 60000 : 60,
    hour: 9,
    minute: 0,
    weekday: 1,
    monthDay: 1,
    cronExpression: cadence?.type === 'cron' ? cadence.expression : '',
    timezone:
      cadence?.type === 'cron'
        ? (cadence.timezone ?? '')
        : new Intl.DateTimeFormat().resolvedOptions().timeZone,
    maxRuns: schedule?.spec.maxRuns?.toString() ?? '',
    expiresAt: schedule?.spec.expiresAt ? localDateTime(schedule.spec.expiresAt) : '',
    misfire: schedule?.spec.misfirePolicy ?? 'default',
    ...(cadence?.type === 'cron' && recognizePreset(cadence.expression)),
  };
}

function localDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function scheduleCadence(draft: ScheduleFormDraft): ScheduleSpec['cadence'] {
  if (draft.cadenceKind === 'interval') {
    return { type: 'interval', everyMs: draft.intervalMinutes * 60000 };
  }
  const { hour, minute, weekday, monthDay } = draft;
  const expressions = {
    hourly: `${minute} * * * *`,
    daily: `${minute} ${hour} * * *`,
    weekdays: `${minute} ${hour} * * 1-5`,
    weekly: `${minute} ${hour} * * ${weekday}`,
    monthly: `${minute} ${hour} ${monthDay} * *`,
    cron: draft.cronExpression,
  };
  return {
    type: 'cron',
    expression: expressions[draft.cadenceKind],
    ...(draft.timezone && { timezone: draft.timezone }),
  };
}

export function schedulePatch(
  draft: ScheduleFormDraft,
  current: Schedule,
  dirty: Partial<Record<keyof ScheduleFormDraft, boolean>>,
): ScheduleUpdate {
  const cadence = scheduleCadence(draft);
  const unchangedCadence =
    cadence.type === current.spec.cadence.type &&
    (cadence.type === 'interval' && current.spec.cadence.type === 'interval'
      ? cadence.everyMs === current.spec.cadence.everyMs
      : cadence.type === 'cron' &&
        current.spec.cadence.type === 'cron' &&
        cadence.expression === current.spec.cadence.expression &&
        cadence.timezone === current.spec.cadence.timezone);
  return {
    ...(dirty.name && { name: draft.name || null }),
    ...(dirty.prompt && { prompt: draft.prompt }),
    ...(!unchangedCadence &&
      (dirty.cadenceKind ||
        dirty.hour ||
        dirty.minute ||
        dirty.weekday ||
        dirty.monthDay ||
        dirty.cronExpression ||
        dirty.timezone ||
        dirty.intervalMinutes) && { cadence }),
    ...(dirty.maxRuns && { maxRuns: draft.maxRuns ? Number(draft.maxRuns) : null }),
    ...(dirty.expiresAt && { expiresAt: draft.expiresAt ? Date.parse(draft.expiresAt) : null }),
    ...(dirty.misfire && { misfirePolicy: draft.misfire === 'default' ? null : draft.misfire }),
  };
}

export function recognizePreset(expression: string): Partial<ScheduleFormDraft> {
  const parts = expression.split(' ');
  if (parts.length !== 5) return {};
  const [minute, hour, day, month, weekday] = parts;
  if (month !== '*' || !RE_INTEGER.test(minute)) return {};
  const time = { minute: Number(minute), hour: Number(hour) };
  if (hour === '*' && day === '*' && weekday === '*') {
    return { cadenceKind: 'hourly', minute: Number(minute) };
  }
  if (!RE_INTEGER.test(hour)) return {};
  if (day === '*' && weekday === '*') return { cadenceKind: 'daily', ...time };
  if (day === '*' && weekday === '1-5') return { cadenceKind: 'weekdays', ...time };
  if (day === '*' && RE_WEEKDAY.test(weekday)) {
    return { cadenceKind: 'weekly', weekday: Number(weekday), ...time };
  }
  if (weekday === '*' && RE_INTEGER.test(day)) {
    return { cadenceKind: 'monthly', monthDay: Number(day), ...time };
  }
  return {};
}
