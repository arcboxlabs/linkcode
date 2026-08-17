import type { AgentKind, ApprovalPolicyState, EffortLevel } from '@linkcode/schema';
import type { EffortOption, ModelOption } from '@linkcode/ui/native';

export interface SessionApprovalChipProps {
  approvalPolicy: ApprovalPolicyState | null;
  onPolicyChange: (policyId: string) => void;
}

export interface SessionSelectorChipProps {
  kind: AgentKind;
  /** Text on the chip — the running model (and effort), or a placeholder. */
  selectorValue: string;
  /** Account-backed options; null while loading (model submenu hidden). */
  models: ModelOption[] | null;
  /** `modelChoiceKey` of the entry matching the running model, or null while unknown. */
  currentModelKey: string | null;
  onModelChange: (model: ModelOption) => void;
  effortOptions: EffortOption[] | undefined;
  currentEffort: EffortLevel | null;
  onEffortChange: (effort: EffortLevel) => void;
}
