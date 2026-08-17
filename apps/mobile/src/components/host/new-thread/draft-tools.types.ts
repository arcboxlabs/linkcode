import type { AgentKind, ApprovalPolicy } from '@linkcode/schema';
import type { EffortOption, ModelOption } from '@linkcode/ui/native';

/** Tag for the leading "Default" entry in each menu — picking it clears the explicit pick, so
 * the agent's own startup resolution applies again. */
export const DEFAULT_TAG = '__default__';

export function clearable(onChange: (value: string | null) => void): (value: string) => void {
  return (value) => {
    onChange(value === DEFAULT_TAG ? null : value);
  };
}

export interface ApprovalChipProps {
  policies: ApprovalPolicy[];
  policyId: string | null;
  policyValue: string;
  onPolicyIdChange: (policyId: string | null) => void;
}

export interface AgentSelectorChipProps {
  kind: AgentKind;
  onKindChange: (kind: AgentKind) => void;
  /** Account-backed options; null while loading (model submenu hidden). */
  models: ModelOption[] | null;
  /** `modelChoiceKey` of the explicit pick, or null for default. */
  modelKey: string | null;
  onModelKeyChange: (key: string | null) => void;
  /** Text on the chip — resolved model (and effort), or the harness name. */
  selectorValue: string;
  effortOptions: EffortOption[] | undefined;
  effort: string | null;
  onEffortChange: (effort: string | null) => void;
}
