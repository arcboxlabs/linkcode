import type { AgentEvent } from '@linkcode/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const piMock = vi.hoisted(() => {
  const model = { id: 'claude-sonnet-4-6', provider: 'anthropic' };
  const unsubscribe = vi.fn();
  const session = {
    model,
    subscribe: vi.fn(() => unsubscribe),
    bindExtensions: vi.fn().mockResolvedValue(undefined),
  };
  return {
    authStorage: { setRuntimeApiKey: vi.fn() },
    createAgentSession: vi.fn(() => Promise.resolve({ session })),
    model,
    modelRegistry: {
      find: vi.fn(),
      getAvailable: vi.fn(() => [model]),
      registerProvider: vi.fn(),
    },
    session,
  };
});

vi.mock('@earendil-works/pi-coding-agent', () => ({
  AuthStorage: { create: () => piMock.authStorage },
  ModelRegistry: { create: () => piMock.modelRegistry },
  createAgentSession: piMock.createAgentSession,
  // The adapter registers an inline approval extension through a resource loader (CODE-248); this
  // stub satisfies that wiring so onStart reaches model reflection.
  DefaultResourceLoader: class {
    reload() {
      return Promise.resolve();
    }
  },
}));

import { PiAdapter } from '../native/pi';

describe('PiAdapter model reflection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reflects the model selected by the SDK without forcing a model override', async () => {
    const adapter = new PiAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));

    await adapter.start({ kind: 'pi', cwd: '/tmp/repo' });

    expect(piMock.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: piMock.model }),
    );
    expect(events).toContainEqual({
      type: 'model-update',
      model: 'anthropic/claude-sonnet-4-6',
    });
  });
});
