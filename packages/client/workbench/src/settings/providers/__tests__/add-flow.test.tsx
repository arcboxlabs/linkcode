// @vitest-environment jsdom

import type { AgentRuntimes } from '@linkcode/schema';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentRuntimeOnboarding } from '../../../agent-runtime/onboarding';
import { AddAccountForm, ServiceCatalogView } from '../add-flow';

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

  it('offers a dedicated StepFun API key entry', async () => {
    const onPick = vi.fn();
    render(<ServiceCatalogView onPick={onPick} />);
    fireEvent.click(screen.getByText('serviceName.stepfun'));
    expect(onPick).toHaveBeenCalledWith('stepfun');
    cleanup();

    const onSubmit = vi.fn();
    render(
      <AddAccountForm
        serviceId="stepfun"
        runtimes={undefined}
        onboarding={onboarding()}
        busy={false}
        onBack={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const secret = document.querySelector<HTMLInputElement>('input[type="password"]');
    if (!secret) throw new Error('credential input missing');
    fireEvent.change(secret, { target: { value: 'stepfun-test-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.submit' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'stepfun',
          credential: { type: 'api-key', key: 'stepfun-test-key' },
        }),
      ),
    );
  });

  it('asks nothing about protocol for a service serving several shapes', () => {
    render(
      <AddAccountForm
        serviceId="openrouter"
        runtimes={undefined}
        onboarding={onboarding()}
        busy={false}
        onBack={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    // Each agent resolves its own shape, so the user is never asked to pick one.
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
  });

  it('adds LinkCode Gateway only after the explicit user action', async () => {
    const createKey = vi.fn().mockResolvedValue('lc-gateway-key');
    const onSubmit = vi.fn();
    render(
      <AddAccountForm
        serviceId="linkcode-gateway"
        runtimes={undefined}
        onboarding={onboarding()}
        busy={false}
        linkCodeGateway={{
          signedIn: true,
          signingIn: false,
          signIn: vi.fn(),
          createKey,
        }}
        onBack={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(createKey).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'linkCodeUseGateway' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(createKey).toHaveBeenCalledWith('serviceName.linkcode-gateway');
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'linkcode-gateway',
        credential: { type: 'auth-token', token: 'lc-gateway-key' },
      }),
    );
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('endpoint');
  });

  it('keeps the Desktop-only Gateway out of clients without its host bridge', () => {
    const onPick = vi.fn();
    const { rerender } = render(<ServiceCatalogView onPick={onPick} />);
    expect(screen.queryByText('serviceName.linkcode-gateway')).toBeNull();

    rerender(<ServiceCatalogView onPick={onPick} linkCodeGatewayAvailable />);
    fireEvent.click(screen.getByText('serviceName.linkcode-gateway'));
    expect(onPick).toHaveBeenCalledWith('linkcode-gateway');
  });

  it('stores template values instead of a resolved endpoint', async () => {
    const onSubmit = vi.fn();
    const { container } = render(
      <AddAccountForm
        serviceId="cloudflare-gateway"
        runtimes={undefined}
        onboarding={onboarding()}
        busy={false}
        onBack={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Account ID' }), {
      target: { value: '8f3a' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Gateway ID' }), {
      target: { value: 'prod' },
    });
    const secret = container.querySelector('input[type="password"]');
    if (!secret) throw new Error('credential input missing');
    fireEvent.change(secret, { target: { value: 'cf-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'form.submit' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const account = onSubmit.mock.calls[0]?.[0];
    expect(account).toMatchObject({
      service: 'cloudflare-gateway',
      credential: { type: 'auth-token', token: 'cf-token' },
      endpointParams: { account_id: '8f3a', gateway_id: 'prod' },
    });
    // One key can resolve to a different endpoint per agent, so none is pinned here.
    expect(account).not.toHaveProperty('endpoint');
  });
});
