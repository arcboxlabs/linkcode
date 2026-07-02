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
 * Sensor configuration for the sidebar's sortables, overriding two PointerSensor defaults that
 * assume drag handles are non-interactive:
 *
 * - `preventActivation` normally blocks drags whose pointerdown lands on an interactive child.
 *   Sidebar rows and group headers are *made of* buttons, so that default made them undraggable.
 *   Only text inputs stay protected — dragging to select text in the header's rename field must
 *   never start a group drag.
 * - `activationConstraints` normally activates instantly (no threshold) inside an explicit
 *   handle, which would swallow plain clicks on the header's collapse toggle and action buttons.
 *   A uniform 5px distance threshold keeps clicks as clicks; touch keeps a hold delay so
 *   scrolling over rows doesn't start drags.
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
