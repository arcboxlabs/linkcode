// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginSettingsPanel } from '../plugin-settings-panel';

const RE_SECRET = /secret/i;

function translateKey(key: string, values?: { name?: string }): string {
  return values?.name === undefined ? key : `${key}:${values.name}`;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

describe('PluginSettingsPanel', () => {
  it('renders static sections while daemon-backed values are loading', () => {
    render(
      <PluginSettingsPanel
        units={undefined}
        connections={undefined}
        busy={false}
        onEnabledChange={vi.fn()}
        onConnectionChange={vi.fn()}
        onAddConnection={vi.fn()}
        onEditConnection={vi.fn()}
        onRemoveConnection={vi.fn()}
      />,
    );

    expect(screen.getByText('hint')).toBeTruthy();
    expect(screen.getByText('toolsTitle')).toBeTruthy();
    expect(screen.getByText('connectionsTitle')).toBeTruthy();
  });

  it('exposes saved state without a secret and forwards enablement changes', () => {
    const onEnabledChange = vi.fn();
    render(
      <PluginSettingsPanel
        units={[
          {
            id: 'github-read',
            label: 'GitHub tools',
            description: 'Read-only access',
            enabled: false,
            connectionId: 'github-personal',
            connectionOptions: [{ id: 'github-personal', label: 'Personal GitHub' }],
          },
        ]}
        connections={[
          {
            id: 'github-personal',
            label: 'Personal GitHub',
            credentialType: 'auth-token',
          },
        ]}
        busy={false}
        onEnabledChange={onEnabledChange}
        onConnectionChange={vi.fn()}
        onAddConnection={vi.fn()}
        onEditConnection={vi.fn()}
        onRemoveConnection={vi.fn()}
      />,
    );

    expect(screen.getByText('credentialSaved')).toBeTruthy();
    expect(screen.queryByText(RE_SECRET)).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'enabledLabel:GitHub tools' }));
    expect(onEnabledChange).toHaveBeenCalledWith('github-read', true);
  });
});
