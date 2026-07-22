import { describe, expect, it } from 'vitest';
import { pluginConnectorUpdate } from '../plugins-settings';

describe('plugin connector secret editing', () => {
  it('keeps the saved credential when the masked edit field stays empty', () => {
    expect(
      pluginConnectorUpdate('github-personal', {
        label: 'Personal GitHub',
        credentialType: 'auth-token',
        secret: '',
      }),
    ).toEqual({
      type: 'update',
      connectorId: 'github-personal',
      label: 'Personal GitHub',
    });
  });

  it('replaces the credential only when the user enters a new secret', () => {
    expect(
      pluginConnectorUpdate('github-personal', {
        label: 'Personal GitHub',
        credentialType: 'auth-token',
        secret: 'github_pat_new',
      }),
    ).toEqual({
      type: 'update',
      connectorId: 'github-personal',
      label: 'Personal GitHub',
      credential: { type: 'auth-token', secret: 'github_pat_new' },
    });
  });
});
