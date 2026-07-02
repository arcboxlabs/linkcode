/**
 * `timestamp` relative to `now` (defaults to the current time), e.g. "2 minutes ago". `locale`
 * defaults to the runtime's locale; tests pin it for deterministic output.
 */
export function relativeTimeLabel(timestamp: number, now = Date.now(), locale?: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffSeconds = Math.round((timestamp - now) / 1000);
  if (Math.abs(diffSeconds) < 60) return rtf.format(diffSeconds, 'second');

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 7) return rtf.format(diffDays, 'day');

  const diffWeeks = Math.round(diffDays / 7);
  return rtf.format(diffWeeks, 'week');
}
