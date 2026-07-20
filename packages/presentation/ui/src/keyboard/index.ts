export type { KeyboardShortcutBinding } from './hooks';
export {
  setKeyboardShortcutPlatform,
  useKeyboardShortcut,
  useKeyboardShortcutLabel,
  useKeyboardShortcutLabels,
  useKeyboardShortcutListener,
} from './hooks';
export type {
  KeyboardPlatform,
  KeyboardShortcut,
  KeyboardShortcutChord,
  KeyboardShortcuts,
} from './registry';
export { formatKeyboardShortcut, isKeyboardShortcutLocalTarget } from './registry';
