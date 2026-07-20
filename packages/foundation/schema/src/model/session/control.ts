import { z } from 'zod';

/** Session modes (e.g. plan / accept-edits) the agent advertises and the user can switch between. */
export const SessionModeIdSchema = z.string().min(1);
export type SessionModeId = z.infer<typeof SessionModeIdSchema>;

export const SessionModeSchema = z.object({
  modeId: SessionModeIdSchema,
  name: z.string(),
  description: z.string().optional(),
});
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const SessionModeStateSchema = z.object({
  availableModes: z.array(SessionModeSchema),
  currentModeId: SessionModeIdSchema,
});
export type SessionModeState = z.infer<typeof SessionModeStateSchema>;

/**
 * Approval policies — the permission/safety axis: when the agent asks before acting. Orthogonal
 * to the workflow SessionMode axis above (see packages/presentation/ui approval-policy.ts for the rationale).
 * Adapters advertise their own policy list and translate ids per agent.
 */
export const ApprovalPolicyIdSchema = z.string().min(1);
export type ApprovalPolicyId = z.infer<typeof ApprovalPolicyIdSchema>;

export const ApprovalPolicySchema = z.object({
  policyId: ApprovalPolicyIdSchema,
  name: z.string(),
  description: z.string().optional(),
});
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

/** Full policy state, emitted whole (at session start and after every switch) so clients never
 * join a separate list against a current-id event; empty `availablePolicies` hides the selector. */
export const ApprovalPolicyStateSchema = z.object({
  availablePolicies: z.array(ApprovalPolicySchema),
  currentPolicyId: ApprovalPolicyIdSchema,
});
export type ApprovalPolicyState = z.infer<typeof ApprovalPolicyStateSchema>;
