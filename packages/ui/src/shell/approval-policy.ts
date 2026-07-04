/**
 * Approval policy — the permission/safety axis: when the agent asks before acting, following
 * Codex's design where it sits alongside sandboxing (`approvalPolicy` + `sandboxMode` on the codex
 * adapter's thread options). It is orthogonal to the workflow modes the agent advertises (plan /
 * goal / … — see session-modes.ts) and deliberately NOT another `modeId` on that channel: mixing
 * the two axes into one mutually exclusive union forced UI workarounds like remembering the last
 * policy while plan mode was on.
 *
 * TODO(backend): the daemon does not expose this axis yet — this file is the contract the
 * frontend expects it to fill:
 *   - session state: `{ approvalPolicy: string }` plus the per-agent policy option list
 *     (id / name / description) so `STUB_APPROVAL_POLICIES` below can be deleted;
 *   - state reflected to clients through a session event (like `current-mode-update` today);
 *   - a `set-approval-policy { policyId }` input instead of overloading ACP's `set-mode`;
 *     adapters translate per agent (codex → approval_policy/sandbox, claude-code → its
 *     permission modes: default / acceptEdits / bypassPermissions).
 * Until then the composer keeps the selection in local state with no wire effect.
 */

export interface ApprovalPolicyOption {
  id: string;
  name: string;
  description?: string;
}

// TODO(backend): replace with the agent-advertised policy list from the session state above.
export const STUB_APPROVAL_POLICIES: ApprovalPolicyOption[] = [
  {
    id: 'default',
    name: 'Ask for approval',
    description: 'Always ask before editing files and running commands.',
  },
  {
    id: 'acceptEdits',
    name: 'Approve for me',
    description: 'Only ask for actions detected as potentially unsafe.',
  },
  {
    id: 'bypassPermissions',
    name: 'Full access',
    description: 'Unrestricted access to files and commands in this workspace.',
  },
];
