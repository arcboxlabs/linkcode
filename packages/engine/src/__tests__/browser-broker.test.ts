import type { WireMessage } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserBrokerService } from '../browser/broker';

class FakeTransport implements Transport {
  readonly sent: WireMessage[] = [];

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(msg: WireMessage): void {
    this.sent.push(msg);
  }

  onMessage(): Unsubscribe {
    return noop;
  }

  onClose(): Unsubscribe {
    return noop;
  }

  close = noop;
}

function lastCommandId(transport: FakeTransport): string {
  const command = transport.sent.findLast((m) => m.payload.kind === 'browser.command');
  if (command?.payload.kind !== 'browser.command') throw new Error('no browser.command sent');
  return command.payload.commandId;
}

describe('BrowserBrokerService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails fast with host-unavailable when no host is registered', async () => {
    const transport = new FakeTransport();
    const broker = new BrowserBrokerService(transport);

    const result = await broker.dispatch('tabs.list', {});

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('host-unavailable');
    expect(transport.sent).toHaveLength(0);
  });

  it('correlates a settlement back to its dispatch', async () => {
    const transport = new FakeTransport();
    const broker = new BrowserBrokerService(transport);
    broker.registerHost('host-1');

    const pending = broker.dispatch('tabs.list', {});
    broker.settle(lastCommandId(transport), { ok: true, data: { tabs: [] } });

    const result = await pending;
    expect(result).toEqual({ ok: true, data: { tabs: [] } });
  });

  it('times out an unanswered command with a retryable closed code', async () => {
    const transport = new FakeTransport();
    const broker = new BrowserBrokerService(transport);
    broker.registerHost('host-1');

    const pending = broker.dispatch('tab.snapshot', { tabId: 't1' });
    vi.advanceTimersByTime(15000);

    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('timeout');
      expect(result.error.retryable).toBe(true);
    }
    // A settlement arriving after the timeout is ignored, not crashed on.
    broker.settle(lastCommandId(transport), { ok: true });
  });

  it('fails all pending commands when the host detaches', async () => {
    const transport = new FakeTransport();
    const broker = new BrowserBrokerService(transport);
    broker.registerHost('host-1');

    const pending = broker.dispatch('tabs.list', {});
    broker.detachHost('host-1');

    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('host-unavailable');
    expect(broker.available).toBe(false);
  });

  it('ignores a stale detach for a superseded host', () => {
    const transport = new FakeTransport();
    const broker = new BrowserBrokerService(transport);
    broker.registerHost('host-1');
    broker.registerHost('host-2');

    broker.detachHost('host-1');

    expect(broker.available).toBe(true);
  });

  it('fails commands pending against a superseded host on re-registration', async () => {
    const transport = new FakeTransport();
    const broker = new BrowserBrokerService(transport);
    broker.registerHost('host-1');

    const pending = broker.dispatch('tabs.list', {});
    broker.registerHost('host-2');

    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('host-unavailable');
  });

  it('broadcasts availability transitions', () => {
    const transport = new FakeTransport();
    const broker = new BrowserBrokerService(transport);

    broker.registerHost('host-1');
    broker.detachHost('host-1');

    const availability = transport.sent.flatMap((m) =>
      m.payload.kind === 'browser.host.changed' ? [m.payload.available] : [],
    );
    expect(availability).toEqual([true, false]);
  });
});
