import type { Sensors } from '@dnd-kit/dom';
import { KeyboardSensor, PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom';

function isTextInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Overrides two PointerSensor defaults that assume non-interactive drag handles: default
 * `preventActivation` would make the button-built rows/headers undraggable, so only text inputs
 * stay protected (drag-to-select in the rename field must not start a group drag); and instant
 * in-handle activation would swallow plain clicks, so a 5px distance threshold keeps clicks as
 * clicks while touch keeps a hold delay so scrolling over rows doesn't start drags.
 */
export const SIDEBAR_SORTABLE_SENSORS: Sensors = [
  PointerSensor.configure({
    activationConstraints: (event) =>
      event.pointerType === 'touch'
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: 5 })]
        : [new PointerActivationConstraints.Distance({ value: 5 })],
    preventActivation: (event) => isTextInputTarget(event.target),
  }),
  KeyboardSensor,
];
