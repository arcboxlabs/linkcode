const MAX_REASONING_SUMMARY_LENGTH = 160;
const RE_SUMMARY_WHITESPACE = /\s+/gu;

/** Normalizes an explicitly public provider summary for compact disclosure headers. */
export function publicReasoningSummary(summary: string | undefined): string | undefined {
  const normalized = summary?.replaceAll(RE_SUMMARY_WHITESPACE, ' ').trim();
  if (!normalized) return undefined;
  const characters = [...normalized];
  if (characters.length <= MAX_REASONING_SUMMARY_LENGTH) return normalized;
  return `${characters
    .slice(0, MAX_REASONING_SUMMARY_LENGTH - 1)
    .join('')
    .trimEnd()}…`;
}
