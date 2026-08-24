import { describe, expect, it } from 'vitest';
import { restrictedAdapterFactory } from '../agent-factory';

describe('restrictedAdapterFactory', () => {
  it('returns undefined when unrestricted, so the engine falls back to the bare createAdapter', () => {
    expect(restrictedAdapterFactory(null)).toBeUndefined();
  });

  it('constructs an allowed kind', () => {
    const factory = restrictedAdapterFactory(['pi']);
    expect(factory).toBeDefined();
    expect(factory?.('pi').kind).toBe('pi');
  });

  it('rejects a kind outside the allowlist', () => {
    const factory = restrictedAdapterFactory(['pi']);
    expect(() => factory?.('codex')).toThrow('codex');
  });
});
