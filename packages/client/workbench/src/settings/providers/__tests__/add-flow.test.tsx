// @vitest-environment jsdom

import type { AgentRuntimes } from '@linkcode/schema';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRuntimeOnboarding } from '../../../agent-runtime/onboarding';
import { AddAccountForm } from '../add-flow';

function translateKey(key: string): string {
  return key;
}

vi.mock('use-intl', () => ({
  useTranslations: () => translateKey,
}));

afterEach(cleanup);

function onboarding(overrides: Partial<AgentRuntimeOnboarding> = {}): AgentRuntimeOnboarding {
  return {
    cues: {},
    download: vi.fn(),
    acknowledgeUnverified: vi.fn(),
    login: vi.fn(),
    submitLoginCode: vi.fn(),
    cancelLogin: vi.fn(),
    ...overrides,
  };
}

function signedOutRuntimes(): AgentRuntimes {
  return {
    'claude-code': {
      status: 'available',
      source: 'detected',
      auth: { loggedIn: false },
    },
    codex: { status: 'available', source: 'detected', auth: { loggedIn: false } },
  };
}

describe('subscription account creation', () => {
  it('starts Claude login and creates the account only from the success callback', () => {
    const login = vi.fn();
    const onSubmit = vi.fn();
    render(
      <AddAccountForm
        serviceId="claude-sub"
        runtimes={signedOutRuntimes()}
        onboarding={onboarding({
          cues: { 'claude-code': { state: 'needs-login', phase: 'idle' } },
          login,
        })}
        busy={false}
        onBack={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'login' }));
    expect(login).toHaveBeenCalledWith('claude-code', expect.any(Function));
    expect(onSubmit).not.toHaveBeenCalled();

    const onSuccess = login.mock.calls[0]?.[1] as (() => void) | undefined;
    act(() => onSuccess?.());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'claude-sub',
        credential: { type: 'oauth', agent: 'claude-code' },
      }),
    );
  });

  it('forwards Claude authorization codes and cancellation to the shared state machine', () => {
    const submitLoginCode = vi.fn();
    const cancelLogin = vi.fn();
    render(
      <AddAccountForm
        serviceId="claude-sub"
        runtimes={signedOutRuntimes()}
        onboarding={onboarding({
          cues: {
            'claude-code': {
              state: 'needs-login',
              phase: 'awaiting-code',
              url: 'https://claude.ai/oauth/authorize',
            },
          },
          submitLoginCode,
          cancelLogin,
        })}
        busy={false}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('loginCodePlaceholder'), {
      target: { value: ' pasted-code ' },
    });
    expect(screen.getByRole('textbox', { name: 'form.label' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'loginSubmit' }));
    expect(submitLoginCode).toHaveBeenCalledWith('claude-code', 'pasted-code');
    fireEvent.click(screen.getByRole('button', { name: 'loginCancel' }));
    expect(cancelLogin).toHaveBeenCalledWith('claude-code');
  });

  it('adds an already authenticated ChatGPT subscription without restarting login', () => {
    const login = vi.fn();
    const onSubmit = vi.fn();
    const runtimes: AgentRuntimes = {
      codex: {
        status: 'available',
        source: 'detected',
        auth: { loggedIn: true, email: 'user@example.com' },
      },
    };
    render(
      <AddAccountForm
        serviceId="chatgpt-sub"
        runtimes={runtimes}
        onboarding={onboarding({ login })}
        busy={false}
        onBack={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'form.submit' }));
    expect(login).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'chatgpt-sub',
        credential: { type: 'oauth', agent: 'codex' },
      }),
    );
  });
});

describe('non-subscription account creation', () => {
  it('keeps direct API services on the existing key form', async () => {
    const login = vi.fn();
    const onSubmit = vi.fn();
    render(
      <AddAccountForm
        serviceId="anthropic-api"
        runtimes={undefined}
        onboarding={onboarding({ login })}
        busy={false}
        onBack={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('sk-ant-…'), { target: { value: 'sk-ant-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.submit' }));
    expect(login).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'anthropic-api',
          credential: { type: 'api-key', key: 'sk-ant-test' },
        }),
      ),
    );
  });

  it.each([
    ['openai-chat', 'https://api.deepseek.com', 0],
    ['openai-responses', 'https://api.deepseek.com', 1],
    ['anthropic', 'https://api.deepseek.com/anthropic', 2],
  ])('creates a DeepSeek account with its %s endpoint', async (protocol, baseUrl, variantIndex) => {
    const onSubmit = vi.fn();
    render(
      <AddAccountForm
        serviceId="deepseek"
        runtimes={undefined}
        onboarding={onboarding()}
        busy={false}
        onBack={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getAllByRole('radio').at(variantIndex)!);
    fireEvent.change(screen.getByPlaceholderText('sk-…'), { target: { value: 'sk-deepseek' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.submit' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'deepseek',
          credential: { type: 'api-key', key: 'sk-deepseek' },
          endpoint: { baseUrl, protocol },
        }),
      ),
    );
  });
});
