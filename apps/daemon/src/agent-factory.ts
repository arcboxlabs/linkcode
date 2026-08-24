import type { AdapterFactory } from '@linkcode/agent-adapter';
import { createAdapter } from '@linkcode/agent-adapter';
import type { AgentKind } from '@linkcode/schema';

/**
 * Restricted-brand adapter gate (CODE-618): wraps `createAdapter` to reject any kind outside the
 * allowlist. Only guards new adapter construction — a session started before a restriction landed
 * keeps running on its existing adapter instance, and history reads never call this at all.
 * `null` (unrestricted, the default build) returns `undefined` so the engine falls back to the
 * bare `createAdapter`, an exact no-op.
 */
export function restrictedAdapterFactory(
  allowedAgents: readonly AgentKind[] | null,
): AdapterFactory | undefined {
  if (allowedAgents === null) return undefined;
  return (kind) => {
    if (!allowedAgents.includes(kind)) {
      throw new Error(`agent kind ${kind} is not available in this build`);
    }
    return createAdapter(kind);
  };
}
