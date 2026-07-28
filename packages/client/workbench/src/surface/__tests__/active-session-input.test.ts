import type { AgentInput, SessionId } from '@linkcode/schema';
import { describe, expect, it, vi } from 'vitest';
import { submitActiveSessionInput } from '../active-session-input';

const sessionId = 'session-1' as SessionId;

describe('submitActiveSessionInput', () => {
  it('propagates correlated input rejection to the caller', async () => {
    const failure = new Error('Session is busy');
    const trigger = vi.fn().mockRejectedValue(failure);
    const input: AgentInput = { type: 'prompt', content: [] };

    await expect(submitActiveSessionInput(sessionId, input, trigger)).rejects.toBe(failure);
    expect(trigger).toHaveBeenCalledWith({ sessionId, input });
  });

  it('rejects without dispatching when the active session is gone', async () => {
    const trigger = vi.fn();

    await expect(
      submitActiveSessionInput(null, { type: 'shell-command', command: 'pwd' }, trigger),
    ).rejects.toThrow('No active session');
    expect(trigger).not.toHaveBeenCalled();
  });
});
