import {
  canonicalDirectHostUrl,
  formatDiscoveryUrl,
  toDiscoveredDaemon,
} from '@mobile/runtime/daemon-discovery';
import { describe, expect, it } from 'vitest';

describe('daemon discovery endpoints', () => {
  it('formats DNS, IPv4, and IPv6 endpoints as Socket.IO origins', () => {
    expect(formatDiscoveryUrl('studio.local.', 19523)).toBe('http://studio.local:19523');
    expect(formatDiscoveryUrl('192.168.1.8', 19523)).toBe('http://192.168.1.8:19523');
    expect(formatDiscoveryUrl('2001:db8::1234', 19523)).toBe('http://[2001:db8::1234]:19523');
    expect(formatDiscoveryUrl('fe80::1234%en0', 19523)).toBeUndefined();
  });

  it('maps the native service identity without changing its display name', () => {
    expect(
      toDiscoveredDaemon({
        id: 'Studio|_linkcode._tcp|local',
        name: 'Studio',
        host: 'studio.local.',
        port: 19523,
      }),
    ).toEqual({
      id: 'Studio|_linkcode._tcp|local',
      name: 'Studio',
      url: 'http://studio.local:19523',
    });
  });

  it('matches saved origins regardless of URL casing or a root slash', () => {
    expect(canonicalDirectHostUrl('HTTP://Studio.Local:19523/')).toBe(
      canonicalDirectHostUrl('http://studio.local:19523'),
    );
  });
});
