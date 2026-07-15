import { describe, expect, it } from 'vitest';
import { resolveStartupTarget } from '../startup';

describe('resolveStartupTarget', () => {
  it('sends a signed-out first run to sign-in', () => {
    expect(resolveStartupTarget({ hosts: [], lastActiveHostId: null, signedIn: false })).toEqual({
      kind: 'sign-in',
    });
  });

  it('sends a signed-in user with no hosts to the machine list', () => {
    expect(resolveStartupTarget({ hosts: [], lastActiveHostId: null, signedIn: true })).toEqual({
      kind: 'connect',
    });
  });

  it('prefers the last active host over the account state', () => {
    expect(
      resolveStartupTarget({
        hosts: [{ id: 'a' }, { id: 'b' }],
        lastActiveHostId: 'b',
        signedIn: false,
      }),
    ).toEqual({ kind: 'host', hostId: 'b' });
  });

  it('falls back to the first host when the last active one is gone', () => {
    expect(
      resolveStartupTarget({
        hosts: [{ id: 'a' }, { id: 'b' }],
        lastActiveHostId: 'gone',
        signedIn: true,
      }),
    ).toEqual({ kind: 'host', hostId: 'a' });
  });
});
