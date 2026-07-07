import type { AgentRuntimes, WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { Engine } from '../engine';

function harness(agentRuntimes?: AgentRuntimes) {
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
  const engine = new Engine(transport, { agentRuntimes });
  function inject(payload: WirePayload): void {
    nullthrow(handler, 'engine not started')(createWireMessage(payload));
  }
  return { engine, sent, inject };
}

describe('agent-runtime.list', () => {
  it('serves the boot-time probe result', async () => {
    const runtimes: AgentRuntimes = {
      'claude-code': {
        status: 'available',
        source: 'detected',
        path: '/x/claude',
        version: '2.1.202',
      },
      pi: { status: 'available', source: 'builtin' },
    };
    const { engine, sent, inject } = harness(runtimes);
    await engine.start();
    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' });
    expect(sent).toContainEqual({ kind: 'agent-runtime.listed', replyTo: 'r1', runtimes });
  });

  it('serves an empty record when the host injected none', async () => {
    const { engine, sent, inject } = harness();
    await engine.start();
    inject({ kind: 'agent-runtime.list', clientReqId: 'r1' });
    expect(sent).toContainEqual({ kind: 'agent-runtime.listed', replyTo: 'r1', runtimes: {} });
  });
});
