/**
 * Browser `KeyboardEvent` → HID keyboard usage (page 7), US layout — the shape the simulator's
 * HID keyboard injection consumes. Meta/Command combos return `null` so application shortcuts
 * (palette, panels) keep working; characters outside the US layout (IME output, option-composed
 * accents) also return `null` and are left to the browser.
 */

export interface SimulatorKeyPress {
  usage: number;
  /** Modifier usages (`0xE0..`) held around the key. */
  modifiers: number[];
}

const SHIFT_USAGE = 0xe1;

const NAMED_KEYS: Readonly<Record<string, number>> = {
  Enter: 0x28,
  Escape: 0x29,
  Backspace: 0x2a,
  Tab: 0x2b,
  ' ': 0x2c,
  Delete: 0x4c,
  ArrowRight: 0x4f,
  ArrowLeft: 0x50,
  ArrowDown: 0x51,
  ArrowUp: 0x52,
};

/** Punctuation → `[usage, needsShift]`, US layout. */
const PUNCTUATION: Readonly<Record<string, readonly [number, boolean]>> = {
  '-': [0x2d, false],
  _: [0x2d, true],
  '=': [0x2e, false],
  '+': [0x2e, true],
  '[': [0x2f, false],
  '{': [0x2f, true],
  ']': [0x30, false],
  '}': [0x30, true],
  '\\': [0x31, false],
  '|': [0x31, true],
  ';': [0x33, false],
  ':': [0x33, true],
  "'": [0x34, false],
  '"': [0x34, true],
  '`': [0x35, false],
  '~': [0x35, true],
  ',': [0x36, false],
  '<': [0x36, true],
  '.': [0x37, false],
  '>': [0x37, true],
  '/': [0x38, false],
  '?': [0x38, true],
  '!': [0x1e, true],
  '@': [0x1f, true],
  '#': [0x20, true],
  $: [0x21, true],
  '%': [0x22, true],
  '^': [0x23, true],
  '&': [0x24, true],
  '*': [0x25, true],
  '(': [0x26, true],
  ')': [0x27, true],
};

/** Decompose a key event; `null` = not ours (let the browser/app handle it). */
export function simulatorKeyPress(event: {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): SimulatorKeyPress | null {
  // Command combos belong to the app (palette, panel toggles), option composes characters.
  if (event.metaKey || event.altKey) return null;
  const modifiers: number[] = [];
  if (event.ctrlKey) modifiers.push(0xe0);
  if (event.shiftKey) modifiers.push(SHIFT_USAGE);

  const named = NAMED_KEYS[event.key];
  if (named !== undefined) return { usage: named, modifiers };
  if (event.key.length !== 1) return null;

  const code = event.key.codePointAt(0) ?? 0;
  // a-z
  if (code >= 0x61 && code <= 0x7a) return { usage: 0x04 + code - 0x61, modifiers };
  // A-Z (caps lock may produce these without shiftKey; the device needs shift either way)
  if (code >= 0x41 && code <= 0x5a) {
    return { usage: 0x04 + code - 0x41, modifiers: withShift(modifiers) };
  }
  // 1-9, then 0
  if (code >= 0x31 && code <= 0x39) return { usage: 0x1e + code - 0x31, modifiers };
  if (event.key === '0') return { usage: 0x27, modifiers };

  const punctuation = PUNCTUATION[event.key];
  if (punctuation === undefined) return null;
  const [usage, needsShift] = punctuation;
  return { usage, modifiers: needsShift ? withShift(modifiers) : modifiers };
}

function withShift(modifiers: number[]): number[] {
  return modifiers.includes(SHIFT_USAGE) ? modifiers : [...modifiers, SHIFT_USAGE];
}
