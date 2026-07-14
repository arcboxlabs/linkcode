import { describe, expect, it } from 'vitest';
import { jsonValueEqual } from '../json-equal';

describe('jsonValueEqual', () => {
  it('compares primitives strictly', () => {
    expect(jsonValueEqual(1, 1)).toBe(true);
    expect(jsonValueEqual('a', 'a')).toBe(true);
    expect(jsonValueEqual(1, '1')).toBe(false);
    expect(jsonValueEqual(0, false)).toBe(false);
    expect(jsonValueEqual(null, null)).toBe(true);
    expect(jsonValueEqual(null, {})).toBe(false);
  });

  it('ignores object key order at every depth', () => {
    const a = { x: { p: 1, q: [1, { r: true }] }, y: 'z' };
    const b = { y: 'z', x: { q: [1, { r: true }], p: 1 } };
    expect(jsonValueEqual(a, b)).toBe(true);
  });

  it('detects nested differences', () => {
    expect(jsonValueEqual({ x: { p: 1 } }, { x: { p: 2 } })).toBe(false);
    expect(jsonValueEqual({ x: [1, 2] }, { x: [2, 1] })).toBe(false);
    expect(jsonValueEqual({ x: [1, 2] }, { x: [1, 2, 3] })).toBe(false);
    expect(jsonValueEqual([], {})).toBe(false);
  });

  it('treats undefined-valued keys as absent, like JSON serialization', () => {
    expect(jsonValueEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(jsonValueEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(jsonValueEqual({ a: undefined }, { a: null })).toBe(false);
    expect(jsonValueEqual({}, { a: 0 })).toBe(false);
  });
});
