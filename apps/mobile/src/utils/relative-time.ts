const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 604_800_000;

// Hermes ships Intl.DateTimeFormat but not Intl.RelativeTimeFormat, so use-intl's
// format.relativeTime throws at runtime — this compact notation needs neither.
const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** Compact relative age ("now", "5m", "2h", "3d", "2w"); older than a month falls back to a date. */
export function formatRelativeShort(timestamp: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  if (elapsed < 5 * WEEK) return `${Math.floor(elapsed / WEEK)}w`;
  return shortDate.format(timestamp);
}
