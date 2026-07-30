import type { AgentInput, SessionId } from '@linkcode/schema';
import { noop } from 'foxact/noop';
import { useSessionSelectionStore } from './selection-store';

type InputTrigger = (request: { sessionId: SessionId; input: AgentInput }) => Promise<unknown>;

/** Submit through the correlated request so callers can retain UI state until the host accepts. */
export function submitActiveSessionInput(input: AgentInput, trigger: InputTrigger): Promise<void> {
  const { selectedId: sessionId, draft } = useSessionSelectionStore.getState();
  if (draft) return Promise.reject(new Error('No active session'));
  if (!sessionId) return Promise.reject(new Error('No active session'));
  return trigger({ sessionId, input }).then(noop);
}
