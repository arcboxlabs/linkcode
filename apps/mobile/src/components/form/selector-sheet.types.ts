import type { ModelOption } from '@linkcode/ui/native';
import { groupModelsByProvider, modelChoiceKey } from '@linkcode/ui/native';

export interface SelectorChipAxis {
  title: string;
  /** Option id drawn selected, or null for none. */
  selection: string | null;
  options: Array<{ id: string; label: string }>;
  onSelect: (id: string) => void;
}

export interface SelectorModelGroup {
  /** Provider header above the rows, or null for headerless rows. */
  label: string | null;
  options: Array<{ id: string; label: string }>;
}

export interface SelectorModelAxis {
  title: string;
  selection: string | null;
  groups: SelectorModelGroup[];
  onSelect: (id: string) => void;
}

/** Model rows for the sheet: flat for a single-account list, provider-headed groups when the list
 * spans accounts — the headers replace the per-row account subtitle a flat list would need. */
export function modelAxisGroups(models: ModelOption[]): SelectorModelGroup[] {
  const toOption = (model: ModelOption) => ({ id: modelChoiceKey(model), label: model.label });
  const providerGroups = groupModelsByProvider(models);
  if (providerGroups === null) return [{ label: null, options: models.map(toOption) }];
  const groups: SelectorModelGroup[] = [];
  if (providerGroups.ungrouped.length > 0) {
    groups.push({ label: null, options: providerGroups.ungrouped.map(toOption) });
  }
  for (const group of providerGroups.groups) {
    groups.push({ label: group.label, options: group.options.map(toOption) });
  }
  return groups;
}
