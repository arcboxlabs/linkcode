import type { PrimaryAction } from '@mobile/components/shell/primary-action';

/** iOS carries the primary action in the header bar items (pre-26) or the tab-bar slot (26+);
 * this twin exists so the shared tab routes can reference one component name on both platforms. */
export function PrimaryActionFab(_props: { action: PrimaryAction | null }): React.ReactNode {
  return null;
}
