import { describe, expect, it } from 'vitest';
import { resolveNotificationRoute } from '../notification-route';

describe('resolveNotificationRoute', () => {
  const hosts = [{ id: 'local host', tunnelHostId: 'tunnel-1' }];

  it('routes known tunnel hosts, falls back for unknown hosts, and rejects invalid data', () => {
    expect(resolveNotificationRoute({ hostId: 'tunnel-1', sessionId: 'session/1' }, hosts)).toEqual(
      { type: 'session', hostId: 'local host', sessionId: 'session/1' },
    );
    expect(resolveNotificationRoute({ hostId: 'tunnel-2', sessionId: 'session-2' }, hosts)).toEqual(
      {
        type: 'connect',
      },
    );
    expect(resolveNotificationRoute({ hostId: 'tunnel-1' }, hosts)).toBeNull();
    expect(
      resolveNotificationRoute({ tunnelHostId: 'tunnel-1', sessionId: 'session-1' }, hosts),
    ).toBeNull();
  });
});
