import { Effect, Logger as EffectLogger } from 'effect';
import type { DestinationStream } from 'pino';
import { describe, expect, it } from 'vitest';
import { sanitizeDiagnostic } from '../diagnostic-sanitizer';
import { createDaemonLogger, createEffectLogger } from '../logger';

function collectingDestination(lines: string[]): DestinationStream {
  return {
    write(message) {
      lines.push(message);
    },
  };
}

function parseLine(lines: string[]): Record<string, unknown> {
  const line = lines[0];
  if (!line) throw new Error('Expected one log line');
  return JSON.parse(line);
}

describe('daemon logger', () => {
  it('emits structured JSON and redacts credentials at supported nesting levels', () => {
    const lines: string[] = [];
    const target = createDaemonLogger(collectingDestination(lines));

    target.info(
      {
        apiKey: 'root-secret',
        attachmentSecret: 'attachment-secret',
        credential: { key: 'credential-secret', token: 'credential-token' },
        headers: { authorization: 'Bearer secret' },
        nested: { apiKey: 'nested-secret', token: 'nested-token' },
        providers: { codex: { apiKey: 'provider-secret' } },
        accounts: [{ credential: { key: 'account-secret' } }],
        plugins: {
          connectors: [{ credential: { type: 'auth-token', secret: 'plugin-secret' } }],
        },
        sessionId: 'session-1',
      },
      'Session started',
    );

    expect(parseLine(lines)).toMatchObject({
      name: 'linkcode-daemon',
      level: 30,
      msg: 'Session started',
      apiKey: '[Redacted]',
      attachmentSecret: '[Redacted]',
      credential: '[Redacted]',
      headers: { authorization: '[Redacted]' },
      nested: { apiKey: '[Redacted]', token: '[Redacted]' },
      providers: { codex: { apiKey: '[Redacted]' } },
      accounts: [{ credential: '[Redacted]' }],
      plugins: { connectors: [{ credential: '[Redacted]' }] },
      sessionId: 'session-1',
    });
  });

  it('sanitizes credential text in structured values and Error diagnostics', () => {
    const lines: string[] = [];
    const target = createDaemonLogger(collectingDestination(lines));
    const cause = new Error('refresh failed with token=child-secret');
    const error = new Error('request failed: Authorization: Bearer top-secret', { cause });

    target.error(
      {
        err: error,
        response: {
          password: 'structured-secret',
          detail: 'upstream returned apiKey=foreign-secret after 25ms',
          status: 'retryable timeout',
        },
      },
      `Agent request failed with ${['sk', 'abcdefghijklmnopqrstuvwxyz'].join('-')}`,
    );

    const event = parseLine(lines);
    expect(event).toMatchObject({
      msg: 'Agent request failed with [Redacted]',
      err: {
        message: 'request failed: Authorization: [Redacted]',
        cause: { message: 'refresh failed with token=[Redacted]' },
      },
      response: {
        password: '[Redacted]',
        detail: 'upstream returned apiKey=[Redacted] after 25ms',
        status: 'retryable timeout',
      },
    });
  });

  it('provides the same pure sanitization boundary for Sentry events', () => {
    const event = sanitizeDiagnostic({
      message: 'connection failed after 25ms with Bearer abc.def-123',
      extra: {
        access_token: 'secret',
        client_secret: 'also-secret',
        diagnostic: 'ECONNRESET from api.linkcode.ai',
      },
    });

    expect(event).toEqual({
      message: 'connection failed after 25ms with Bearer [Redacted]',
      extra: {
        access_token: '[Redacted]',
        client_secret: '[Redacted]',
        diagnostic: 'ECONNRESET from api.linkcode.ai',
      },
    });
  });

  it('routes Effect logs through Pino with only approved contextual bindings', async () => {
    const lines: string[] = [];
    const target = createDaemonLogger(collectingDestination(lines));
    const layer = EffectLogger.layer([createEffectLogger(target)]);

    await Effect.runPromise(
      Effect.logWarning('Schedule recovery failed', {
        scheduleId: 'schedule-1',
        subsystem: 'store',
        operation: 'recover',
        token: 'not-logged',
        prompt: 'not-logged',
      }).pipe(Effect.provide(layer)),
    );

    expect(parseLine(lines)).toMatchObject({
      level: 40,
      msg: 'Schedule recovery failed',
      source: 'effect',
      scheduleId: 'schedule-1',
      subsystem: 'store',
      operation: 'recover',
    });
    expect(parseLine(lines)).not.toHaveProperty('token');
    expect(parseLine(lines)).not.toHaveProperty('prompt');
    expect(lines).toHaveLength(1);
  });

  it('preserves a sanitized Effect failure as the structured Pino error', async () => {
    const lines: string[] = [];
    const target = createDaemonLogger(collectingDestination(lines));
    const layer = EffectLogger.layer([createEffectLogger(target)]);
    const error = new Error('provider failed with token=secret-value');

    await Effect.runPromise(
      Effect.logError(
        'Schedule run failed',
        { scheduleId: 'schedule-1', operation: 'automation.schedule.run' },
        error,
      ).pipe(Effect.provide(layer)),
    );

    expect(parseLine(lines)).toMatchObject({
      level: 50,
      msg: 'Schedule run failed',
      source: 'effect',
      scheduleId: 'schedule-1',
      operation: 'automation.schedule.run',
      err: { message: 'provider failed with token=[Redacted]' },
    });
  });
});
