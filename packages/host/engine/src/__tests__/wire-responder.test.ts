import type { WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { Effect, Metric } from 'effect';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { RequestError } from '../failure';
import { observeRequest } from '../observability';
import { WireResponder } from '../wire/responder';

function recordingTransport(): { transport: Transport; sent: WirePayload[] } {
  const sent: WirePayload[] = [];
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(message: WireMessage) {
      sent.push(message.payload);
    },
    onMessage: () => noop,
    onClose: () => noop,
    close: noop,
  };
  return { transport, sent };
}

describe('wire responder', () => {
  it('preserves an explicitly safe request failure', () => {
    const { transport, sent } = recordingTransport();
    const responder = new WireResponder(transport);

    responder.sendFailure(
      'request-1',
      new RequestError({ code: 'not_found', message: 'Workspace not found' }),
    );

    expect(sent).toEqual([
      {
        kind: 'request.failed',
        replyTo: 'request-1',
        code: 'not_found',
        message: 'Workspace not found',
      },
    ]);
  });

  it('does not expose an unexpected rejection', async () => {
    const { transport, sent } = recordingTransport();
    const responder = new WireResponder(transport);

    await Effect.runPromise(
      observeRequest(
        responder.reply('request-1', Effect.fail(new Error('provider rejected token sk-secret'))),
        'test.unexpected-failure',
      ),
    );
    const outcomes = await Effect.runPromise(Metric.snapshot);

    expect(sent).toEqual([
      {
        kind: 'request.failed',
        replyTo: 'request-1',
        code: 'internal_error',
        message: 'Internal engine error',
      },
    ]);
    expect(outcomes).toContainEqual(
      expect.objectContaining({
        id: 'linkcode_engine_operation_outcomes_total',
        attributes: {
          subsystem: 'request',
          kind: 'test.unexpected-failure',
          outcome: 'failed',
        },
      }),
    );
  });

  it('does not reply when an Effect request is interrupted', async () => {
    const { transport, sent } = recordingTransport();
    const responder = new WireResponder(transport);

    await Effect.runPromiseExit(responder.reply('request-1', Effect.interrupt));

    expect(sent).toEqual([]);
  });
});
