import { Effect, Logger as EffectLogger } from 'effect';
import type { DestinationStream } from 'pino';
import { describe, expect, it } from 'vitest';
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
      credential: { key: '[Redacted]', token: '[Redacted]' },
      headers: { authorization: '[Redacted]' },
      nested: { apiKey: '[Redacted]', token: '[Redacted]' },
      providers: { codex: { apiKey: '[Redacted]' } },
      accounts: [{ credential: { key: '[Redacted]' } }],
      sessionId: 'session-1',
    });
  });

  it('routes Effect logs through Pino with only approved contextual bindings', async () => {
    const lines: string[] = [];
    const target = createDaemonLogger(collectingDestination(lines));
    const layer = EffectLogger.layer([createEffectLogger(target)]);

    await Effect.runPromise(
      Effect.logWarning('Schedule recovery failed', {
        scheduleId: 'schedule-1',
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
      operation: 'recover',
    });
    expect(parseLine(lines)).not.toHaveProperty('token');
    expect(parseLine(lines)).not.toHaveProperty('prompt');
  });
});
