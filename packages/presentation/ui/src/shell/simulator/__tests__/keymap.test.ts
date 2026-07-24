import { describe, expect, it } from 'vitest';
import { simulatorKeyPress } from '../keymap';

function event(
  key: string,
  mods: Partial<Record<'ctrl' | 'shift' | 'alt' | 'meta', boolean>> = {},
) {
  return {
    key,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    metaKey: mods.meta ?? false,
  };
}

describe('simulatorKeyPress', () => {
  it('maps letters, digits, and named keys to page-7 usages', () => {
    expect(simulatorKeyPress(event('a'))).toEqual({ usage: 0x04, modifiers: [] });
    expect(simulatorKeyPress(event('z'))).toEqual({ usage: 0x1d, modifiers: [] });
    expect(simulatorKeyPress(event('1'))).toEqual({ usage: 0x1e, modifiers: [] });
    expect(simulatorKeyPress(event('0'))).toEqual({ usage: 0x27, modifiers: [] });
    expect(simulatorKeyPress(event('Enter'))).toEqual({ usage: 0x28, modifiers: [] });
    expect(simulatorKeyPress(event('Backspace'))).toEqual({ usage: 0x2a, modifiers: [] });
    expect(simulatorKeyPress(event(' '))).toEqual({ usage: 0x2c, modifiers: [] });
  });

  it('adds shift for uppercase and shifted punctuation even without shiftKey (caps lock)', () => {
    expect(simulatorKeyPress(event('A'))).toEqual({ usage: 0x04, modifiers: [0xe1] });
    expect(simulatorKeyPress(event('?', { shift: true }))).toEqual({
      usage: 0x38,
      modifiers: [0xe1],
    });
    // Shift is not duplicated when already held.
    expect(simulatorKeyPress(event('A', { shift: true }))).toEqual({
      usage: 0x04,
      modifiers: [0xe1],
    });
  });

  it('leaves command/option combos and non-US characters to the app', () => {
    expect(simulatorKeyPress(event('k', { meta: true }))).toBeNull();
    expect(simulatorKeyPress(event('é', { alt: true }))).toBeNull();
    expect(simulatorKeyPress(event('你'))).toBeNull();
    expect(simulatorKeyPress(event('F1'))).toBeNull();
  });

  it('keeps control as a held modifier', () => {
    expect(simulatorKeyPress(event('c', { ctrl: true }))).toEqual({
      usage: 0x06,
      modifiers: [0xe0],
    });
  });
});
