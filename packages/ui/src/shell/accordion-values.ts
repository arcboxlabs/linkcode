/** Returns controlled accordion values whose open state changed. */
export function changedAccordionValues<Value extends string>(
  values: readonly Value[],
  currentOpenValues: readonly string[],
  nextOpenValues: readonly string[],
): Value[] {
  const currentOpen = new Set(currentOpenValues);
  const nextOpen = new Set(nextOpenValues);
  return values.filter((value) => currentOpen.has(value) !== nextOpen.has(value));
}

/** Returns the controlled values for thread groups whose panels are open. */
export function openThreadGroupValues<Group extends { collapseKey: string; collapsed: boolean }>(
  groups: readonly Group[],
): string[] {
  return groups.flatMap((group) => (group.collapsed ? [] : [group.collapseKey]));
}
