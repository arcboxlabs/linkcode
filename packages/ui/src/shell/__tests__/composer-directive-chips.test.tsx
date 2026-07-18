// @vitest-environment jsdom

import type { AgentCapabilities, AgentCommand } from '@linkcode/schema';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Composer } from '../composer';
import {
  composerText,
  composerTextbox,
  pressInComposer,
  setupComposerTestDOM,
  typeInComposer,
} from './composer-test-utils';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

beforeAll(setupComposerTestDOM);
afterEach(cleanup);

const COMMANDS: AgentCommand[] = [
  { name: 'compact', description: 'Compact the context' },
  { name: 'review', description: 'Review the changes' },
];
const SLASH_CAPABILITIES: AgentCapabilities = { shellCommand: false, slashCommands: true };

interface ComposerFixtureProps {
  agentCapabilities?: AgentCapabilities;
  agentCommands?: AgentCommand[];
  onInvokeCommand?: (name: string, args?: string) => void;
  onRunShellCommand?: (command: string) => void;
  onSend?: React.ComponentProps<typeof Composer>['onSend'];
}

function composer({
  agentCapabilities = SLASH_CAPABILITIES,
  agentCommands = COMMANDS,
  onInvokeCommand = vi.fn(),
  onRunShellCommand,
  onSend = vi.fn(),
}: ComposerFixtureProps = {}): React.ReactNode {
  return (
    <Composer
      agentCapabilities={agentCapabilities}
      agentCommands={agentCommands}
      attachmentsSupported={false}
      currentModeId={null}
      disabled={false}
      isRunning={false}
      onInvokeCommand={onInvokeCommand}
      onRunShellCommand={onRunShellCommand}
      onSend={onSend}
      onStop={vi.fn()}
    />
  );
}

describe('Composer directive chips', () => {
  it('explains an unknown command and blocks submit', async () => {
    const user = userEvent.setup();
    const onInvokeCommand = vi.fn();
    const onSend = vi.fn();
    render(composer({ onInvokeCommand, onSend }));

    typeInComposer('/typo ');
    const chip = screen.getByRole('button', { name: '/typo' });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('commandUnknown')).toBeDefined();
    await user.hover(chip);

    await waitFor(() => {
      const tooltip = document.querySelector('[data-slot="tooltip-popup"]');
      expect(tooltip?.textContent).toBe('commandUnknown');
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(true);
    await pressInComposer('Enter');
    expect(onInvokeCommand).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(composerText()).toBe('/typo ');
  });

  it('converts an unknown command to sendable prose', async () => {
    const user = userEvent.setup();
    const onInvokeCommand = vi.fn();
    const onSend = vi.fn();
    render(composer({ onInvokeCommand, onSend }));
    typeInComposer('/typo ');

    await user.click(screen.getByRole('button', { name: '/typo' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'removeDirective' })).toBeDefined();
    await user.click(within(menu).getByRole('menuitem', { name: 'convertToText' }));

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(screen.queryByRole('button', { name: '/typo' })).toBeNull();
    typeInComposer('more');
    expect(composerText()).toBe('/typo more');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(false);
    await pressInComposer('Enter');
    expect(composerText()).toBe('');
    expect(onInvokeCommand).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledExactlyOnceWith([{ type: 'text', text: '/typo more' }]);
    expect(composerText()).toBe('');
  });

  it('updates an existing command chip when the catalog arrives', async () => {
    const onInvokeCommand = vi.fn();
    const onSend = vi.fn();
    const { rerender } = render(composer({ agentCommands: [], onInvokeCommand, onSend }));
    typeInComposer('/review ');

    expect(screen.getByRole('button', { name: '/review' })).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(true);
    rerender(composer({ agentCommands: COMMANDS, onInvokeCommand, onSend }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '/review' })).toBeNull());
    expect(screen.getByText('/review')).toBeDefined();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(false);
    await pressInComposer('Enter');
    expect(onInvokeCommand).toHaveBeenCalledExactlyOnceWith('review', undefined);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('explains an unavailable shell directive and blocks submit', async () => {
    const user = userEvent.setup();
    const onRunShellCommand = vi.fn();
    const onSend = vi.fn();
    render(composer({ onRunShellCommand, onSend }));

    typeInComposer('$ ls -la');
    const shellChip = screen.getByRole('button', { name: '$' });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('shellUnsupported')).toBeDefined();
    await user.hover(shellChip);

    await waitFor(() => {
      const tooltip = document.querySelector('[data-slot="tooltip-popup"]');
      expect(tooltip?.textContent).toBe('shellUnsupported');
    });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'send' }).disabled).toBe(true);
    await pressInComposer('Enter');
    expect(onRunShellCommand).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
    expect(composerText()).toBe('$ ls -la');
  });

  it('relays command-menu navigation from the editor', async () => {
    render(composer());
    typeInComposer('/');
    expect(screen.getByRole('listbox')).toBeDefined();

    await pressInComposer('ArrowDown');
    await pressInComposer('Enter');

    expect(composerText()).toBe('/review ');
    expect(screen.getByText('/review', { selector: '[data-slot="badge"]' })).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(composerTextbox()).toBeDefined();
  });
});
