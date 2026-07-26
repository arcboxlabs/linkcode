import type { SimulatorButton } from '@linkcode/schema';
import { useKeyboardShortcut } from '@linkcode/ui';

/**
 * Simulator.app's own bindings, so muscle memory carries over (CODE-414). Every chord is scoped to
 * the panel element, so it only fires while the panel is on screen and focusable — these are common
 * keys, and claiming them app-wide would be wrong.
 */
const HOME_SHORTCUT = { code: 'KeyH', modifiers: ['primary', 'shift'] } as const;
const LOCK_SHORTCUT = { code: 'KeyL', modifiers: ['primary'] } as const;
const VOLUME_UP_SHORTCUT = { code: 'ArrowUp', modifiers: ['primary'] } as const;
const VOLUME_DOWN_SHORTCUT = { code: 'ArrowDown', modifiers: ['primary'] } as const;
const ROTATE_SHORTCUT = { code: 'ArrowRight', modifiers: ['primary'] } as const;

export function useSimulatorShortcuts({
  owner,
  enabled,
  onButton,
  onRotate,
}: {
  owner: React.RefObject<Element | null>;
  /** False while no device is claimed; the chord is then left for anything else to handle. */
  enabled: boolean;
  onButton: (button: SimulatorButton) => void;
  onRotate: () => void;
}): void {
  const pressButton = (button: SimulatorButton) => (): boolean => {
    if (!enabled) return false;
    onButton(button);
    return true;
  };

  useKeyboardShortcut({
    actionId: 'simulator.home',
    shortcut: HOME_SHORTCUT,
    owner,
    handler: pressButton('home'),
  });
  useKeyboardShortcut({
    actionId: 'simulator.lock',
    shortcut: LOCK_SHORTCUT,
    owner,
    handler: pressButton('lock'),
  });
  useKeyboardShortcut({
    actionId: 'simulator.volume-up',
    shortcut: VOLUME_UP_SHORTCUT,
    owner,
    handler: pressButton('volumeUp'),
  });
  useKeyboardShortcut({
    actionId: 'simulator.volume-down',
    shortcut: VOLUME_DOWN_SHORTCUT,
    owner,
    handler: pressButton('volumeDown'),
  });
  useKeyboardShortcut({
    actionId: 'simulator.rotate',
    shortcut: ROTATE_SHORTCUT,
    owner,
    handler() {
      if (!enabled) return false;
      onRotate();
      return true;
    },
  });
}
