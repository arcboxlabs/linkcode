// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationPromptAlertProps } from '../conversation-prompt-alert';
import { ConversationPromptAlert } from '../conversation-prompt-alert';

function translateKey(key: string): string {
  return key;
}

function translationsMock(): typeof translateKey {
  return translateKey;
}

vi.mock('use-intl', () => ({
  useTranslations: translationsMock,
}));

const CHOICES = [
  { id: 'first', label: 'First' },
  { id: 'second', label: 'Second' },
] as const;
const FIRST_CHOICE_NAME = /First$/;
const SECOND_CHOICE_NAME = /Second$/;

afterEach(cleanup);

function renderPrompt(overrides: Partial<ConversationPromptAlertProps> = {}) {
  const onSkip = vi.fn();
  const onSubmit = vi.fn();

  render(
    <ConversationPromptAlert
      choices={CHOICES}
      mode="single"
      title="Prompt"
      onSkip={onSkip}
      {...overrides}
      onSubmit={onSubmit}
    />,
  );

  return { onSkip, onSubmit };
}

describe('ConversationPromptAlert keyboard behavior', () => {
  it('submits a single choice directly when clicked', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderPrompt();

    expect(screen.queryByRole('button', { name: 'submit' })).toBeNull();
    await user.click(screen.getByRole('button', { name: SECOND_CHOICE_NAME }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({ selectedIds: ['second'] });
  });

  it('submits a focused single choice with Enter', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderPrompt();
    const second = screen.getByRole('button', { name: SECOND_CHOICE_NAME });

    second.focus();
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({ selectedIds: ['second'] });
  });

  it('submits a single choice from a shifted physical digit shortcut', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderPrompt();
    const first = screen.getByRole('button', { name: FIRST_CHOICE_NAME });

    first.focus();
    await user.keyboard('{Shift>}[Digit2]{/Shift}');

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({ selectedIds: ['second'] });
  });

  it('uses arrows only to move focus in a single-choice prompt', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderPrompt();
    const first = screen.getByRole('button', { name: FIRST_CHOICE_NAME });
    const second = screen.getByRole('button', { name: SECOND_CHOICE_NAME });
    const skip = screen.getByRole('button', { name: 'skip' });

    skip.focus();
    await user.keyboard('[ArrowDown]');
    expect(document.activeElement).toBe(first);

    expect(
      fireEvent.keyDown(first, {
        code: 'ArrowDown',
        key: 'ArrowDown',
        repeat: true,
      }),
    ).toBe(false);

    expect(document.activeElement).toBe(second);
    expect(second.hasAttribute('aria-pressed')).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit a single choice from modified Enter', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderPrompt();
    const second = screen.getByRole('button', { name: SECOND_CHOICE_NAME });

    second.focus();
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('toggles multiple choices and submits the selected set with Enter', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderPrompt({ mode: 'multiple' });
    const first = screen.getByRole('button', { name: FIRST_CHOICE_NAME });
    const second = screen.getByRole('button', { name: SECOND_CHOICE_NAME });

    await user.click(first);
    await user.keyboard('[Digit2]');

    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(second);
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      customText: undefined,
      selectedIds: ['first', 'second'],
    });
    expect(second.getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles an unselected focused choice before Enter can submit it', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderPrompt({ mode: 'multiple' });
    const first = screen.getByRole('button', { name: FIRST_CHOICE_NAME });
    const second = screen.getByRole('button', { name: SECOND_CHOICE_NAME });

    await user.click(first);
    await user.keyboard('[ArrowDown]');
    expect(document.activeElement).toBe(second);

    await user.keyboard('{Enter}');
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      customText: undefined,
      selectedIds: ['first', 'second'],
    });
  });

  it('preserves native Enter activation for Skip and header actions', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const { onSkip, onSubmit } = renderPrompt({
      action: (
        <button type="button" onClick={onAction}>
          Next prompt
        </button>
      ),
      mode: 'multiple',
    });

    const skip = screen.getByRole('button', { name: 'skip' });
    skip.focus();
    await user.keyboard('{Enter}');

    const action = screen.getByRole('button', { name: 'Next prompt' });
    action.focus();
    await user.keyboard('{Enter}');

    expect(onSkip).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits custom text through the native form path', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderPrompt();
    const input = screen.getByRole('textbox', { name: 'customPlaceholder' });

    await user.type(input, 'Use a safer command');
    await user.keyboard('{Enter}');

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({
      customText: 'Use a safer command',
      selectedIds: [],
    });
  });

  it('clears a custom selection before directly submitting a preset', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderPrompt();
    const input = screen.getByRole('textbox', { name: 'customPlaceholder' });

    await user.type(input, 'Use a safer command');
    expect(screen.getByRole('button', { name: 'submit' })).toBeDefined();

    await user.click(screen.getByRole('button', { name: SECOND_CHOICE_NAME }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith({ selectedIds: ['second'] });
    expect(screen.queryByRole('button', { name: 'submit' })).toBeNull();
  });
});
