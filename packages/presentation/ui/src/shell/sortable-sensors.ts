import type { Sensors } from '@dnd-kit/dom';
import { KeyboardSensor, PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom';

function isTextInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** Preserve text editing and plain clicks while requiring deliberate pointer or touch drags. */
export const SORTABLE_SENSORS: Sensors = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === 'touch'
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
        : [new PointerActivationConstraints.Distance({ value: 5 })],
    preventActivation: (event) => isTextInputTarget(event.target),
  }),
  KeyboardSensor,
];
