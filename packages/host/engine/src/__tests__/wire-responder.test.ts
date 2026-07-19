import type { WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import { RequestError } from '../failure';
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

    await responder.tryReply('request-1', () =>
      Promise.reject(new Error('provider rejected token sk-secret')),
    );

    expect(sent).toEqual([
      {
        kind: 'request.failed',
        replyTo: 'request-1',
        code: 'internal_error',
        message: 'Internal engine error',
      },
    ]);
  });
});
