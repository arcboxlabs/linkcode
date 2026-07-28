import type { WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { AgentLoginChannel } from '../client/agent-login-channel';
import { PendingRegistry } from '../client/pending-registry';

function setup() {
  const sent: WirePayload[] = [];
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: WireMessage) {
      sent.push(msg.payload);
    },
    onMessage: () => noop,
    onClose: () => noop,
    close: noop,
  };
  return { channel: new AgentLoginChannel(transport, new PendingRegistry()), sent };
}

function reqIdOf(sent: WirePayload[], kind: string): string {
  const found = sent.find((p) => p.kind === kind);
  if (!found || !('clientReqId' in found)) throw new Error(`no ${kind} sent`);
  return found.clientReqId;
}

describe('AgentLoginChannel', () => {
  it('resolves start() with the loginId echoed by agent-login.started', async () => {
    const { channel, sent } = setup();
    const started = channel.start('claude-code');
    expect(sent[0]).toMatchObject({ kind: 'agent-login.start', agent: 'claude-code' });
    channel.handleMessage({
      kind: 'agent-login.started',
      replyTo: reqIdOf(sent, 'agent-login.start'),
      loginId: 'login-1',
    });
    await expect(started).resolves.toBe('login-1');
  });

  it('buffers a url/settled that arrive before subscribe and replays them on attach', () => {
    const { channel } = setup();
    channel.handleMessage({
      kind: 'agent-login.url',
      loginId: 'l1',
      url: 'https://x/oauth/authorize',
    });
    channel.handleMessage({ kind: 'agent-login.settled', loginId: 'l1', ok: true });

    const onUrl = vi.fn();
    const onSettled = vi.fn();
    channel.subscribe('l1', { onUrl, onSettled });
    expect(onUrl).toHaveBeenCalledExactlyOnceWith('https://x/oauth/authorize');
    expect(onSettled).toHaveBeenCalledExactlyOnceWith({ ok: true });
  });

  it('delivers live url/settled and tears the subscriber down after settle', () => {
    const { channel } = setup();
    const onUrl = vi.fn();
    const onSettled = vi.fn();
    channel.subscribe('l2', { onUrl, onSettled });

    channel.handleMessage({
      kind: 'agent-login.url',
      loginId: 'l2',
      url: 'https://y/oauth/authorize',
    });
    channel.handleMessage({ kind: 'agent-login.settled', loginId: 'l2', ok: false, error: 'nope' });
    expect(onUrl).toHaveBeenCalledExactlyOnceWith('https://y/oauth/authorize');
    expect(onSettled).toHaveBeenCalledExactlyOnceWith({ ok: false, error: 'nope' });

    // The subscription is gone after settle: a late url must not reach it.
    channel.handleMessage({
      kind: 'agent-login.url',
      loginId: 'l2',
      url: 'https://late/oauth/authorize',
    });
    expect(onUrl).toHaveBeenCalledOnce();
  });

  it('sends submit-code and cancel frames', () => {
    const { channel, sent } = setup();
    channel.submitCode('l3', 'the-code');
    channel.cancel('l3');
    expect(sent).toContainEqual({
      kind: 'agent-login.submit-code',
      loginId: 'l3',
      code: 'the-code',
    });
    expect(sent).toContainEqual({ kind: 'agent-login.cancel', loginId: 'l3' });
  });
});
