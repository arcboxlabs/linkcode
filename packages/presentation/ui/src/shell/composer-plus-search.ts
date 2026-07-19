export function movePlusCommandStart(
  previousValue: string,
  nextValue: string,
  previousStart: number,
): number {
  const start = Math.min(Math.max(previousStart, 0), previousValue.length);
  const prefixLimit = Math.min(previousValue.length, nextValue.length);
  let prefix = 0;
  while (prefix < prefixLimit && previousValue[prefix] === nextValue[prefix]) prefix++;

  let previousEnd = previousValue.length;
  let nextEnd = nextValue.length;
  while (
    previousEnd > prefix &&
    nextEnd > prefix &&
    previousValue[previousEnd - 1] === nextValue[nextEnd - 1]
  ) {
    previousEnd--;
    nextEnd--;
  }

  if (prefix >= start) return start;
  if (previousEnd <= start) return start + nextEnd - previousEnd;
  return nextEnd;
}
