import type { AgentKind, EffortLevel, StartOptions } from '@linkcode/schema';

export interface NewThreadPicks {
  /** An explicitly picked model; `accountId` pins the session to the account it came from. */
  model: { id: string; accountId?: string } | null;
  effort: EffortLevel | null;
  approvalPolicyId: string | null;
}

/** Only explicit picks travel. A displayed default submitted as if chosen would override the
 * agent's own startup resolution (claude's `permissions.defaultMode`, codex's `config.toml`). */
export function buildStartOptions(
  kind: AgentKind,
  cwd: string,
  picks: NewThreadPicks,
): StartOptions {
  return {
    kind,
    cwd,
    ...(picks.model && { model: picks.model.id }),
    ...(picks.model?.accountId !== undefined && { accountId: picks.model.accountId }),
    ...(picks.effort && { effort: picks.effort }),
    ...(picks.approvalPolicyId !== null && { approvalPolicyId: picks.approvalPolicyId }),
  };
}
