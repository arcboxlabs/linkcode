// @vitest-environment jsdom

import type { LinkCodePluginSettings } from '@linkcode/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkCodePluginConfigDialog } from '../linkcode-config-dialog';

function translateKey(key: string, params?: Record<string, unknown>): string {
  return params === undefined ? key : `${key}:${Object.values(params).join(',')}`;
}

vi.mock('use-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

const SETTINGS: LinkCodePluginSettings = {
  account: {
    type: 'string',
    label: 'Account',
    description: 'Full email address',
    required: true,
  },
  password: {
    type: 'password',
    label: 'Authorization code',
    secret: true,
    required: true,
  },
  preset: { type: 'enum', label: 'Provider preset', enum: ['163', 'qq'], default: '163' },
  // Dotted on purpose: react-hook-form reads `.` as a path separator, so this id is the one shape
  // that silently dropped its value before `pluginConfigFormKey` escaped it.
  'body.max': { type: 'number', label: 'Max body characters', default: 8000 },
  readonly: { type: 'boolean', label: 'Read-only', default: false },
};

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof LinkCodePluginConfigDialog>> = {},
) {
  const onSubmit = vi.fn();
  render(
    <LinkCodePluginConfigDialog
      title="linkcode/mail"
      settings={SETTINGS}
      values={{}}
      busy={false}
      onClose={vi.fn()}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit };
}

describe('LinkCodePluginConfigDialog', () => {
  it('renders one control per declared field, secrets masked', () => {
    renderDialog();
    expect(screen.getByText('Account')).toBeDefined();
    expect(screen.getByText('Authorization code')).toBeDefined();
    expect(screen.getByText('Provider preset')).toBeDefined();
    expect(screen.getByText('Max body characters')).toBeDefined();
    expect(screen.getByText('Read-only')).toBeDefined();

    const password = screen.getByPlaceholderText('form.secretPlaceholder');
    expect(password.getAttribute('type')).toBe('password');
    // The masked read never returns secrets, so the input starts blank.
    expect((password as HTMLInputElement).value).toBe('');
  });

  it('prefills non-secret values and manifest defaults', () => {
    renderDialog({ values: { account: 'you@163.com', readonly: true } });
    expect(screen.getByLabelText<HTMLInputElement>('Account').value).toBe('you@163.com');
    expect(screen.getByLabelText<HTMLInputElement>('Max body characters').value).toBe('8000');
    expect(screen.getByRole<HTMLButtonElement>('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('submits a typed per-key patch, keeping blank secrets out of it', async () => {
    const { onSubmit } = renderDialog({ values: { account: 'old@163.com' } });
    fireEvent.change(screen.getByLabelText('Account'), { target: { value: 'new@163.com' } });
    fireEvent.change(screen.getByLabelText('Max body characters'), { target: { value: '4000' } });
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    // preset stays at its manifest default and was never stored, so it is deliberately absent
    // from the patch — writing it would freeze today's default against future manifest upgrades.
    expect(onSubmit).toHaveBeenCalledWith({
      set: {
        account: 'new@163.com',
        // Keyed by the real setting id, not the escaped form key the input was registered under.
        'body.max': 4000,
        readonly: true,
      },
    });
  });

  it('blocks submit on a blank required field', async () => {
    const { onSubmit } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'form.save' }));
    await waitFor(() => expect(screen.getByText('form.required')).toBeDefined());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
