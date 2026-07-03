/**
 * Approval policy — the permission/safety axis: when the agent asks before acting, following
 * Codex's design where it sits alongside sandboxing (`approvalPolicy` + `sandboxMode` on the codex
 * adapter's thread options). It is orthogonal to the workflow modes the agent advertises (plan /
 * goal / … — see session-modes.ts) and deliberately NOT another `modeId` on that channel: mixing
 * the two axes into one mutually exclusive union forced UI workarounds like remembering the last
 * policy while plan mode was on.
 *
 * The daemon owns the axis: adapters advertise their catalog + active pick via the
 * `approval-policy-update` event (folded into `ConversationViewModel.approvalPolicy`), and the
 * composer sends switches through `set-approval-policy`. The picker renders only what the agent
 * advertised — adapters without policies advertise nothing and the menu stays hidden.
 */

/** View-model for one advertised policy (the schema's `ApprovalPolicy`, keyed as a menu option). */
export interface ApprovalPolicyOption {
  id: string;
  name: string;
  description?: string;
}
