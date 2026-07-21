import type { Schedule, ScheduleCadence, ScheduleId, ScheduleStatus } from '@linkcode/schema';

/** A schedule reduced to what the schedule master list renders (localized by the UI). */
export interface AutomationListItem {
  scheduleId: ScheduleId;
  /** Display name: the schedule's name, or an excerpt of its prompt. */
  name: string;
  status: ScheduleStatus;
  cadence: ScheduleCadence;
  nextRunAt?: number;
  lastRunAt?: number;
  updatedAt: number;
}

const NAME_EXCERPT_MAX = 60;
const STATUS_RANK: Record<ScheduleStatus, number> = { active: 0, paused: 1, completed: 2 };

function displayName(schedule: Schedule): string {
  const name = schedule.spec.name?.trim();
  if (name) return name;
  const prompt = schedule.spec.prompt.trim().replaceAll(/\s+/g, ' ');
  return prompt.length > NAME_EXCERPT_MAX ? `${prompt.slice(0, NAME_EXCERPT_MAX - 1)}…` : prompt;
}

/** Active schedules first, then paused, then completed; within a status, most recently updated first. */
export function buildScheduleItems(schedules: Schedule[] | undefined): AutomationListItem[] {
  if (!schedules) return [];
  return schedules
    .map(
      (schedule): AutomationListItem => ({
        scheduleId: schedule.scheduleId,
        name: displayName(schedule),
        status: schedule.status,
        cadence: schedule.spec.cadence,
        nextRunAt: schedule.nextRunAt,
        lastRunAt: schedule.lastRunAt,
        updatedAt: schedule.updatedAt,
      }),
    )
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.updatedAt - a.updatedAt);
}
