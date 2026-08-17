import { describe, expect, it } from 'vitest';
import { linkCodeGatewayError } from '../gateway-error';

describe('linkCodeGatewayError', () => {
  it.each([
    [{ statusCode: 402, responseBody: '{"code":"insufficient_credits"}' }, 'insufficient_credits'],
    [{ message: 'request failed: billing_unavailable' }, 'billing_unavailable'],
  ] as const)('normalizes the frozen billing response %#', (details, code) => {
    expect(linkCodeGatewayError('https://gateway.linkcode.ai/v1', details)).toMatchObject({
      code,
      recoverable: true,
    });
  });

  it('does not reinterpret third-party provider failures', () => {
    expect(
      linkCodeGatewayError('https://api.example.com/v1', {
        statusCode: 402,
        responseBody: '{"code":"insufficient_credits"}',
      }),
    ).toBeUndefined();
  });
});
