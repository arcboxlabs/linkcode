import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@linkcode/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PiAdapter } from '../native/pi';

const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('Pi model registry integration', () => {
  it.each([
    {
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      inputModel: 'claude-sonnet-4-6',
      baseUrl: 'https://api.anthropic.com',
    },
    {
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4.6',
      inputModel: 'anthropic/claude-sonnet-4.6',
      baseUrl: 'https://openrouter.ai/api/v1',
    },
    {
      provider: 'vercel-ai-gateway',
      modelId: 'anthropic/claude-sonnet-4.6',
      inputModel: 'anthropic/claude-sonnet-4.6',
      baseUrl: 'https://ai-gateway.vercel.sh/v1',
    },
    {
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4.6',
      inputModel: 'openrouter/anthropic/claude-sonnet-4.6',
      baseUrl: 'https://openrouter.ai/api/v1',
    },
  ])('resolves $provider input $inputModel to $modelId', async (testCase) => {
    const { provider, modelId, inputModel, baseUrl } = testCase;
    const root = mkdtempSync(join(tmpdir(), 'pi-model-registry-'));
    roots.push(root);
    vi.stubEnv('PI_CODING_AGENT_DIR', root);
    const adapter = new PiAdapter();
    const events: AgentEvent[] = [];
    adapter.onEvent((event) => events.push(event));

    await adapter.start({
      kind: 'pi',
      cwd: root,
      model: inputModel,
      config: { authToken: 'dummy', baseUrl, knownProvider: provider },
    });

    expect(events).toContainEqual({ type: 'model-update', model: `${provider}/${modelId}` });
    await adapter.stop();
  });
});
