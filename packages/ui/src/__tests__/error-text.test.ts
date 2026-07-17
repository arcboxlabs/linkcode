import { describe, expect, it } from 'vitest';
import { normalizeErrorMessage } from '../lib/error-text';

describe('normalizeErrorMessage', () => {
  it('collapses stacked Error: prefixes to one', () => {
    expect(normalizeErrorMessage('Error: Error: No API key found')).toBe('Error: No API key found');
    expect(normalizeErrorMessage('Error:  Error:\tError: boom')).toBe('Error: boom');
  });

  it('keeps a single prefix as-is', () => {
    expect(normalizeErrorMessage('Error: boom')).toBe('Error: boom');
  });

  it('leaves unprefixed messages untouched', () => {
    expect(normalizeErrorMessage('Session is busy: s-1')).toBe('Session is busy: s-1');
    expect(normalizeErrorMessage('TypeError: x is not a function')).toBe(
      'TypeError: x is not a function',
    );
  });

  it('does not touch Error: appearing mid-message', () => {
    expect(normalizeErrorMessage('send failed — Error: boom')).toBe('send failed — Error: boom');
  });
});
