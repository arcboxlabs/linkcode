import type { AgentInput, SessionId } from '@linkcode/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitActiveSessionInput } from '../active-session-input';
import { useSessionSelectionStore } from '../selection-store';

const sessionId = 'session-1' as SessionId;

describe('submitActiveSessionInput', () => {
  beforeEach(() => {
    useSessionSelectionStore.setState({ selectedId: sessionId, draft: null });
  });

  it('propagates correlated input rejection to the caller', async () => {
    const failure = new Error('Session is busy');
    const trigger = vi.fn().mockRejectedValue(failure);
    const input: AgentInput = { type: 'prompt', content: [] };

    await expect(submitActiveSessionInput(input, trigger)).rejects.toBe(failure);
    expect(trigger).toHaveBeenCalledWith({ sessionId, input });
  });

  it('reads the selected session when the input is submitted', async () => {
    const nextSessionId = 'session-2' as SessionId;
    const trigger = vi.fn().mockResolvedValue(undefined);
    const input: AgentInput = { type: 'prompt', content: [] };
    const submit = (): Promise<void> => submitActiveSessionInput(input, trigger);

    useSessionSelectionStore.getState().setSelectedId(nextSessionId);
    await submit();

    expect(trigger).toHaveBeenCalledWith({ sessionId: nextSessionId, input });
  });

  it('rejects without dispatching while the new-session draft is open', async () => {
    const trigger = vi.fn();
    useSessionSelectionStore.getState().startDraft({ workspaceId: null });

    await expect(
      submitActiveSessionInput({ type: 'shell-command', command: 'pwd' }, trigger),
    ).rejects.toThrow('No active session');
    expect(trigger).not.toHaveBeenCalled();
  });
});
