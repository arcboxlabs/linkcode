import { describe, expect, it } from 'vitest';
import {
  OperationError,
  OperationTimeout,
  RequestError,
  toOperationFailure,
  toRequestFailure,
} from '../failure';

describe('engine request failures', () => {
  it('keeps a request error safe for direct presentation', () => {
    const failure = toRequestFailure(
      new RequestError({ code: 'not_found', message: 'Workspace not found' }),
    );

    expect(failure).toEqual({ code: 'not_found', message: 'Workspace not found' });
  });

  it('exposes only the public message from an operation failure', () => {
    const failure = toRequestFailure(
      new OperationError({
        subsystem: 'agent',
        operation: 'session.start',
        publicMessage: 'Agent failed to start',
        cause: new Error('provider rejected token sk-secret'),
      }),
    );

    expect(failure).toEqual({ code: 'operation_failed', message: 'Agent failed to start' });
  });

  it('distinguishes a timeout from other operation failures', () => {
    const failure = toRequestFailure(
      new OperationTimeout({
        operation: 'git.status',
        duration: 10000,
        publicMessage: 'Git status timed out',
      }),
    );

    expect(failure).toEqual({ code: 'timeout', message: 'Git status timed out' });
  });

  it('does not expose an unexpected defect', () => {
    const failure = toRequestFailure(new Error('attachmentSecret=secret-value'));

    expect(failure).toEqual({ code: 'internal_error', message: 'Internal engine error' });
  });

  it('preserves an existing typed failure at an operation boundary', () => {
    const requestError = new RequestError({ code: 'conflict', message: 'Session is busy' });

    const failure = toOperationFailure(requestError, {
      subsystem: 'agent',
      operation: 'session.start',
      publicMessage: 'Agent failed to start',
    });

    expect(failure).toBe(requestError);
  });

  it('wraps a foreign failure with operation context', () => {
    const cause = new Error('ECONNRESET');

    const failure = toOperationFailure(cause, {
      subsystem: 'transport',
      operation: 'transport.connect',
      publicMessage: 'Failed to connect transport',
    });

    expect(failure).toEqual(
      new OperationError({
        subsystem: 'transport',
        operation: 'transport.connect',
        publicMessage: 'Failed to connect transport',
        cause,
      }),
    );
  });
});
