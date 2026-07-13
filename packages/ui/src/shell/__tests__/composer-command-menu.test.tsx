// @vitest-environment jsdom

import type { AgentCommand, SessionMode } from '@linkcode/schema';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../composer';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

const COMMANDS: AgentCommand[] = [
  { name: 'compact', description: 'Compact the context' },
  { name: 'review', description: 'Review the changes' },
];
const MODES: SessionMode[] = [
  { modeId: 'plan', name: 'Plan', description: 'Research and propose changes' },
  { modeId: 'goal', name: 'Goal', description: 'Keep working toward a goal' },
];

function composer(disabled = false): React.ReactNode {
  return (
    <Composer
      agentCapabilities={{ shellCommand: false, slashCommands: true }}
      agentCommands={COMMANDS}
      availableModes={MODES}
      currentModeId={null}
      disabled={disabled}
      isRunning={false}
      onModeChange={vi.fn().mockResolvedValue(undefined)}
      onSend={vi.fn()}
      onStop={vi.fn()}
    />
  );
}

function renderComposer(): void {
  render(composer());
}

afterEach(cleanup);

describe('Composer command menu', () => {
  it('keeps normal plus actions and modes searchable', async () => {
    const user = userEvent.setup();
    renderComposer();
    const input = screen.getByRole('textbox');

    await user.click(screen.getByRole('button', { name: 'add' }));
    expect(screen.getByText('attach')).toBeDefined();
    expect(screen.getByText('mentions')).toBeDefined();
    expect(screen.getByText('Plan')).toBeDefined();
    expect(screen.getByText('Goal')).toBeDefined();

    await user.type(input, 'pla');
    expect(screen.getByText('Plan')).toBeDefined();
    expect(screen.queryByText('Goal')).toBeNull();
  });

  it('gives a typed slash ownership of an open plus search', async () => {
    const user = userEvent.setup();
    renderComposer();
    const input = screen.getByRole('textbox');

    await user.click(screen.getByRole('button', { name: 'add' }));
    await user.type(input, '/');

    expect(screen.getByText('/compact')).toBeDefined();
    expect(screen.getByText('/review')).toBeDefined();
    expect(screen.queryByText('attach')).toBeNull();
    expect(screen.queryByText('mentions')).toBeNull();
    expect(screen.queryByText('Plan')).toBeNull();

    await user.type(input, ' ');
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(screen.queryByText('/compact')).toBeNull());
    await user.keyboard('{Backspace}');
    expect(screen.getByText('/compact')).toBeDefined();
    expect(screen.queryByText('attach')).toBeNull();
  });

  it('keeps direct slash provider-command-only', async () => {
    const user = userEvent.setup();
    renderComposer();
    const input = screen.getByRole('textbox');

    await user.type(input, '/');

    expect(screen.getByRole('listbox')).toBeDefined();
    expect(screen.getByRole('option', { name: /\/compact/ })).toBeDefined();
    expect(screen.getByRole('option', { name: /\/review/ })).toBeDefined();
    expect(screen.queryByText('mentions')).toBeNull();
    expect(screen.queryByText('Plan')).toBeNull();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(screen.getByRole('textbox')).toBe(input);
    expect(document.activeElement).toBe(input);

    await user.keyboard('{Backspace}/');
    expect(screen.getByRole('listbox')).toBeDefined();
    expect(screen.getByRole('option', { name: /\/compact/ })).toBeDefined();
  });

  it('retains command rows only for the visual exit when disabled externally', async () => {
    const user = userEvent.setup();
    const { rerender } = render(composer());

    await user.type(screen.getByRole('textbox'), '/');
    expect(screen.getByText('/compact')).toBeDefined();

    rerender(composer(true));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('/compact')).toBeDefined();
    await waitFor(() => expect(screen.queryByText('/compact')).toBeNull());
  });
});
