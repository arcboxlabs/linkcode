import { describe, expect, it } from 'vitest';
import { sanitizeSentryTransaction } from '..';

describe('sanitizeSentryTransaction', () => {
  it('keeps performance timings while removing private route and request data', () => {
    const privateValues = [
      'file:///private/workspace/repo',
      'https://api.example.test/sessions/private-session-id?token=secret',
      'private-session-id',
    ];
    const event = {
      event_id: 'e'.repeat(32),
      type: 'transaction' as const,
      transaction: privateValues[0],
      release: privateValues[2],
      sdk: { private: privateValues[2] },
      contexts: {
        trace: {
          trace_id: 'a'.repeat(32),
          span_id: 'b'.repeat(16),
          op: privateValues[1],
          status: privateValues[2],
          data: { url: privateValues[1] },
        },
        profile: {
          profile_id: 'c'.repeat(32),
          profiler_id: 'd'.repeat(32),
          private: privateValues[0],
        },
        response: { body: privateValues[2] },
      },
      request: { url: privateValues[1] },
      tags: { workspace: privateValues[2] },
      extra: { path: privateValues[0] },
      spans: [
        {
          trace_id: 'a'.repeat(32),
          span_id: 'c'.repeat(16),
          start_timestamp: 1,
          timestamp: 2,
          op: privateValues[0],
          status: privateValues[2],
          description: privateValues[1],
          data: { url: privateValues[1], sessionId: privateValues[2] },
          measurements: {
            [privateValues[2]]: { value: 1, unit: privateValues[2] },
          },
        },
        {
          trace_id: 'a'.repeat(32),
          span_id: 'd'.repeat(16),
          start_timestamp: 2,
          timestamp: 3,
          op: 'ipc.renderer',
          description: 'ipc settings.get',
          data: { result: privateValues[0] },
        },
      ],
      measurements: {
        lcp: { value: 123, unit: 'millisecond', path: privateValues[0] },
        [privateValues[2]]: { value: 1, unit: privateValues[2] },
      },
    };

    const sanitized = sanitizeSentryTransaction(event, {
      fallbackTransactionName: 'app navigation',
      safeSpanNames: ['ipc settings.get'],
      safeMeasurementNames: ['lcp'],
    });

    expect(sanitized.transaction).toBe('app navigation');
    expect(sanitized.contexts).toEqual({
      profile: {
        profile_id: 'c'.repeat(32),
        profiler_id: 'd'.repeat(32),
      },
      trace: {
        trace_id: 'a'.repeat(32),
        span_id: 'b'.repeat(16),
        parent_span_id: undefined,
        op: undefined,
        status: undefined,
      },
    });
    expect(sanitized.spans[0]).toMatchObject({
      start_timestamp: 1,
      timestamp: 2,
      op: undefined,
      status: undefined,
      data: {},
      description: undefined,
    });
    expect(sanitized.spans[1]?.description).toBe('ipc settings.get');
    expect(sanitized.measurements).toEqual({ lcp: { value: 123, unit: 'millisecond' } });
    expect(JSON.stringify(sanitized)).not.toContain('private');
    expect(JSON.stringify(sanitized)).not.toContain('https://');
    expect(JSON.stringify(sanitized)).not.toContain('file:///');
  });
});
