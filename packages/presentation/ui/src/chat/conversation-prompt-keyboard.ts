const DIGIT_CODE_PATTERN = /^Digit([1-9])$/;
const NUMBER_KEY_PATTERN = /^([1-9])$/;

export function choiceIndexForNumberShortcut(code: string, key: string): number | null {
  const match = DIGIT_CODE_PATTERN.exec(code) ?? NUMBER_KEY_PATTERN.exec(key);
  return match ? Number(match[1]) - 1 : null;
}
