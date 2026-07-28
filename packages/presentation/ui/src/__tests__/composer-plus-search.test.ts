import { describe, expect, it } from 'vitest';
import { movePlusCommandStart } from '../shell/composer-plus-search';

describe('movePlusCommandStart', () => {
  it('keeps the plus search anchored to text typed after opening the menu', () => {
    let value = 'foo';
    let start = value.length;

    let next = 'foobar';
    start = movePlusCommandStart(value, next, start);
    value = next;
    expect(value.slice(start, 6)).toBe('bar');

    next = 'foo';
    start = movePlusCommandStart(value, next, start);
    value = next;
    expect(start).toBe(3);
    expect(value.slice(start, 3)).toBe('');

    next = 'fo';
    start = movePlusCommandStart(value, next, start);
    value = next;
    expect(start).toBe(2);
    expect(value.slice(start, 2)).toBe('');

    next = 'fobar';
    start = movePlusCommandStart(value, next, start);
    value = next;
    expect(value.slice(start, 5)).toBe('bar');
  });

  it('shifts when edits happen before the search start', () => {
    expect(movePlusCommandStart('hello foo', 'hi foo', 6)).toBe(3);
    expect(movePlusCommandStart('hi foo', 'hello foo', 3)).toBe(6);
  });

  it('clamps to the replacement boundary when an edit crosses the search start', () => {
    expect(movePlusCommandStart('foobar', 'foar', 3)).toBe(2);
    expect(movePlusCommandStart('foobar', 'foXYZar', 3)).toBe(5);
  });
});
