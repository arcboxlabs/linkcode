import { describe, expect, it } from 'vitest';
import { sanitizeProductAnalyticsEvent } from '../product-analytics';

describe('sanitizeProductAnalyticsEvent', () => {
  it('drops implicit and unregistered events', () => {
    expect(sanitizeProductAnalyticsEvent({ event: '$pageview', properties: {} })).toBeNull();
    expect(sanitizeProductAnalyticsEvent({ event: 'prompt submitted', properties: {} })).toBeNull();
  });

  it('retains only approved properties on allowed events', () => {
    expect(
      sanitizeProductAnalyticsEvent({
        event: 'thread created',
        properties: {
          agent_kind: 'codex',
          duration_ms: 420,
          surface: 'desktop',
          $current_url: 'file:///private/workspace',
          $session_entry_url: 'file:///private/workspace',
          $screen_width: 1920,
          token: 'project-token',
        },
      }),
    ).toEqual({
      event: 'thread created',
      properties: {
        agent_kind: 'codex',
        duration_ms: 420,
        surface: 'desktop',
        token: 'project-token',
      },
      $set: undefined,
      $set_once: undefined,
    });
  });

  it('retains bounded connection metrics without endpoint details', () => {
    expect(
      sanitizeProductAnalyticsEvent({
        event: 'host connection ready',
        properties: {
          attempt: 2,
          duration_ms: 1750,
          recovered: true,
          endpoint: 'wss://private.example/workspace',
        },
      }),
    ).toEqual({
      event: 'host connection ready',
      properties: { attempt: 2, duration_ms: 1750, recovered: true },
      $set: undefined,
      $set_once: undefined,
    });
  });

  it('allows identity linking without person or URL properties', () => {
    expect(
      sanitizeProductAnalyticsEvent({
        event: '$identify',
        properties: {
          distinct_id: 'user-1',
          $anon_distinct_id: 'anonymous-1',
          $initial_current_url: 'https://private.example',
        },
        $set: { email: 'private@example.test' },
        $set_once: { initial_path: '/private/workspace' },
      }),
    ).toEqual({
      event: '$identify',
      properties: { distinct_id: 'user-1', $anon_distinct_id: 'anonymous-1' },
      $set: undefined,
      $set_once: undefined,
    });
  });
});
