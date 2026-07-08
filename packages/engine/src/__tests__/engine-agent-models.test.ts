import type { AdapterFactory, AgentAdapter } from '@linkcode/agent-adapter';
import type {
  AgentKind,
  AgentModelOption,
  StartOptions,
  WireMessage,
  WirePayload,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { Engine } from '../engine';
import { InMemoryProviderConfigStore } from '../provider-config';

const OPUS: AgentModelOption = { id: 'claude-opus-4-8', label: 'Opus 4.8' };
const SONNET: AgentModelOption = { id: 'claude-sonnet-5', label: 'Sonnet 5' };

/** Only listModels matters here — sessions never start in these tests. */
function catalogAdapter(
  kind: AgentKind,
  listModels: (config?: StartOptions['config']) => Promise<AgentModelOption[]>,
): AgentAdapter {
  return {
    kind,
    historyCapabilities: { list: false, read: false, resume: false },
    start: () => Promise.reject(new Error('not under test')),
    listModels,
    listHistory: () => Promise.resolve({ sessions: [] }),
    readHistory: () => Promise.reject(new Error('not under test')),
    resumeHistory: () => Promise.reject(new Error('not under test')),
    send: () => Promise.reject(new Error('not under test')),
    onEvent: () => noop,
    stop: () => Promise.resolve(),
  };
}

function harness(
  probes: Partial<
    Record<AgentKind, (config?: StartOptions['config']) => Promise<AgentModelOption[]>>
  >,
  providerStore?: InMemoryProviderConfigStore,
) {
  const sent: WirePayload[] = [];
  let handler: ((msg: WireMessage) => void) | null = null;
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: WireMessage) {
      sent.push(msg.payload);
    },
    onMessage(cb) {
      handler = cb;
      return noop;
    },
    onClose: () => noop,
    close: noop,
  };
  const factory: AdapterFactory = (kind) =>
    catalogAdapter(kind, probes[kind] ?? (() => Promise.resolve([])));
  const engine = new Engine(transport, { factory, providerStore });
  async function inject(payload: WirePayload): Promise<void> {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
    // Let the async probe fan-out and the reply settle.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  return { engine, sent, inject };
}

describe('agent-model.list', () => {
  it('serves each advertising kind and omits kinds with an empty catalog', async () => {
    const { engine, sent, inject } = harness({
      'claude-code': () => Promise.resolve([OPUS, SONNET]),
    });
    await engine.start();
    await inject({ kind: 'agent-model.list', clientReqId: 'r1' });
    expect(sent).toContainEqual({
      kind: 'agent-model.listed',
      replyTo: 'r1',
      models: { 'claude-code': [OPUS, SONNET] },
    });
  });

  it('probes each kind once and serves the cached catalog afterwards', async () => {
    let calls = 0;
    const { engine, sent, inject } = harness({
      'claude-code': () => {
        calls += 1;
        return Promise.resolve([OPUS]);
      },
    });
    await engine.start();
    await inject({ kind: 'agent-model.list', clientReqId: 'r1' });
    await inject({ kind: 'agent-model.list', clientReqId: 'r2' });
    expect(calls).toBe(1);
    expect(sent).toContainEqual({
      kind: 'agent-model.listed',
      replyTo: 'r2',
      models: { 'claude-code': [OPUS] },
    });
  });

  it('omits a failed probe from the reply and retries it on the next request', async () => {
    let calls = 0;
    const { engine, sent, inject } = harness({
      'claude-code': () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error('CLI not installed'))
          : Promise.resolve([OPUS]);
      },
    });
    await engine.start();
    await inject({ kind: 'agent-model.list', clientReqId: 'r1' });
    expect(sent).toContainEqual({ kind: 'agent-model.listed', replyTo: 'r1', models: {} });
    await inject({ kind: 'agent-model.list', clientReqId: 'r2' });
    expect(calls).toBe(2);
    expect(sent).toContainEqual({
      kind: 'agent-model.listed',
      replyTo: 'r2',
      models: { 'claude-code': [OPUS] },
    });
  });

  it('passes the stored provider apiKey to the probe', async () => {
    let seenConfig: StartOptions['config'] | undefined;
    const providerStore = new InMemoryProviderConfigStore();
    providerStore.set({ 'claude-code': { enabled: true, apiKey: 'sk-test' } });
    const { engine, inject } = harness(
      {
        'claude-code': (config) => {
          seenConfig = config;
          return Promise.resolve([OPUS]);
        },
      },
      providerStore,
    );
    await engine.start();
    await inject({ kind: 'agent-model.list', clientReqId: 'r1' });
    expect(seenConfig).toEqual({ apiKey: 'sk-test' });
  });
});
