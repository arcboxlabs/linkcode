import { describe, expect, it } from 'vitest';
import { resolveNotificationRoute } from '../notification-route';

describe('resolveNotificationRoute', () => {
  const hosts = [{ id: 'local host', tunnelHostId: 'tunnel-1' }];

  it('routes known tunnel hosts, falls back for unknown hosts, and rejects invalid data', () => {
    expect(
      resolveNotificationRoute({ tunnelHostId: 'tunnel-1', sessionId: 'session/1' }, hosts),
    ).toBe('/host/local%20host/session/session%2F1');
    expect(
      resolveNotificationRoute({ tunnelHostId: 'tunnel-2', sessionId: 'session-2' }, hosts),
    ).toBe('/connect');
    expect(resolveNotificationRoute({ tunnelHostId: 'tunnel-1' }, hosts)).toBeNull();
  });
});
