import { BaseAgentAdapter } from '@linkcode/agent-adapter';
import type { AdapterFactory } from '@linkcode/agent-adapter';
import type { ContentBlock, SessionId, WireMessage } from '@linkcode/schema';
import { createLocalTransportPair, createWireMessage } from '@linkcode/transport';
import { describe, expect, it } from 'vitest';
import { Engine } from '../engine';

/** Minimal adapter that records the prompts it receives and emits nothing of its own. */
class RecordingAdapter extends BaseAgentAdapter {
  readonly kind = 'claude-code' as const;
  readonly prompts: ContentBlock[][] = [];
  protected onStart(): Promise<void> {
    return Promise.resolve();
  }
  protected onPrompt(content: ContentBlock[]): Promise<void> {
    this.prompts.push(content);
    return Promise.resolve();
  }
}

describe('Engine user-message echo', () => {
  it('broadcasts a user-message-chunk for a prompt and forwards it to the adapter', async () => {
    const adapter = new RecordingAdapter();
    const factory: AdapterFactory = () => adapter;
    const [clientSide, engineSide] = createLocalTransportPair();
    const engine = new Engine(engineSide, factory);
    await engine.start();
    await clientSide.connect();

    const received: WireMessage[] = [];
    clientSide.onMessage((m) => received.push(m));
    const waitFor = (pred: (m: WireMessage) => boolean): Promise<WireMessage> =>
      new Promise((resolve) => {
        const existing = received.find(pred);
        if (existing) {
          resolve(existing);
          return;
        }
        const off = clientSide.onMessage((m) => {
          if (pred(m)) {
            off();
            resolve(m);
          }
        });
      });

    clientSide.send(
      createWireMessage({
        kind: 'session.start',
        clientReqId: 'r1',
        opts: { kind: 'claude-code', cwd: '/repo' },
      }),
    );
    const started = await waitFor(
      (m) => m.payload.kind === 'session.started' && m.payload.replyTo === 'r1',
    );
    const sessionId = (started.payload as { sessionId: SessionId }).sessionId;

    clientSide.send(
      createWireMessage({
        kind: 'agent.input',
        clientReqId: 'r2',
        sessionId,
        input: { type: 'prompt', content: [{ type: 'text', text: 'hello' }] },
      }),
    );
    await waitFor((m) => m.payload.kind === 'request.succeeded' && m.payload.replyTo === 'r2');

    const userEvents = received.filter(
      (m) => m.payload.kind === 'agent.event' && m.payload.event.type === 'user-message-chunk',
    );
    expect(userEvents).toHaveLength(1);
    expect(userEvents[0]?.payload).toMatchObject({
      kind: 'agent.event',
      sessionId,
      event: { type: 'user-message-chunk', content: { type: 'text', text: 'hello' } },
    });

    // The prompt is still forwarded to the adapter.
    expect(adapter.prompts).toEqual([[{ type: 'text', text: 'hello' }]]);

    await engine.stop();
    clientSide.close();
  });
});
