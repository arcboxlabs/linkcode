import type { AgentInput, SessionId } from '@linkcode/schema';
import { noop } from 'foxact/noop';

type InputTrigger = (request: { sessionId: SessionId; input: AgentInput }) => Promise<unknown>;

/** Submit through the correlated request so callers can retain UI state until the host accepts. */
export function submitActiveSessionInput(
  sessionId: SessionId | null,
  input: AgentInput,
  trigger: InputTrigger,
): Promise<void> {
  if (!sessionId) return Promise.reject(new Error('No active session'));
  return trigger({ sessionId, input }).then(noop);
}
