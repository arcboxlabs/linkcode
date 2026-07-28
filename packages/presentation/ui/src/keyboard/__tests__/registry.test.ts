import { falseFn, noop, trueFn } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KeyboardShortcutRegistration } from '../registry';
import {
  createKeyboardShortcutRegistry,
  formatKeyboardShortcut,
  isKeyboardShortcutLocalTarget,
} from '../registry';

const PRIMARY_K = { code: 'KeyK', modifiers: ['primary'] } as const;
const CONFLICTING_SHORTCUTS_PATTERN = /conflicting shortcuts/;

function keydown(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const event = new Event('keydown') as KeyboardEvent;
  const properties = {
    altKey: false,
    code: '',
    ctrlKey: false,
    defaultPrevented: false,
    getModifierState: vi.fn(falseFn),
    isComposing: false,
    key: '',
    metaKey: false,
    preventDefault: vi.fn(),
    repeat: false,
    shiftKey: false,
    stopImmediatePropagation: vi.fn(),
    ...overrides,
  };
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  return event;
}

function owner(connected = true, inert = false, closest = vi.fn(() => null)): Element {
  return Object.assign({} as Element, {
    closest: inert ? vi.fn(() => ({}) as Element) : closest,
    isConnected: connected,
  });
}

function binding(
  overrides: Partial<KeyboardShortcutRegistration> = {},
): KeyboardShortcutRegistration {
  const bindingOwner = owner();
  return {
    actionId: 'test.action',
    handler: vi.fn(trueFn),
    owner: () => bindingOwner,
    shortcut: PRIMARY_K,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('keyboard shortcut registry', () => {
  it('recognizes marked local keyboard boundaries', () => {
    class TestElement extends EventTarget {}
    const target = (inside: boolean) =>
      Object.assign(new TestElement(), {
        closest: vi.fn((selector: string) => {
          expect(selector).toBe('[data-keyboard-shortcut-local]');
          return inside ? ({} as Element) : null;
        }),
      });
    vi.stubGlobal('Element', TestElement);
    expect(isKeyboardShortcutLocalTarget(null)).toBe(false);
    expect(isKeyboardShortcutLocalTarget(target(false))).toBe(false);
    expect(isKeyboardShortcutLocalTarget(target(true))).toBe(true);
  });

  it('matches key, code, and platform variants in their derived phase', () => {
    const registry = createKeyboardShortcutRegistry(false);
    registry.register(binding({ actionId: 'physical' }));
    registry.register(binding({ actionId: 'logical', shortcut: { key: 'Escape' } }));
    registry.register(
      binding({
        actionId: 'shifted',
        shortcut: { key: 'Enter', modifiers: ['shift'] },
      }),
    );
    registry.register(
      binding({
        actionId: 'navigate',
        shortcut: {
          mac: { code: 'BracketLeft', modifiers: ['primary'] },
          nonMac: { code: 'ArrowLeft', modifiers: ['alt'] },
        },
      }),
    );
    registry.register(
      binding({
        actionId: 'option-command',
        shortcut: { code: 'KeyB', modifiers: ['primary', 'alt'] },
      }),
    );

    expect(registry.dispatch(keydown({ key: 'Escape' }), false)).toBe(false);
    registry.setPlatform('mac');
    expect([
      registry.dispatch(keydown({ code: 'KeyK', key: 'κ', metaKey: true }), true),
      registry.dispatch(keydown({ altKey: true, code: 'KeyK', metaKey: true }), true),
      registry.dispatch(keydown({ code: 'KeyK', ctrlKey: true }), true),
      registry.dispatch(keydown({ code: 'KeyK', metaKey: true }), false),
      registry.dispatch(keydown({ key: 'Escape' }), true),
      registry.dispatch(keydown({ key: 'Escape' }), false),
      registry.dispatch(keydown({ key: 'Enter', shiftKey: true }), false),
      registry.dispatch(keydown({ code: 'BracketLeft', metaKey: true }), true),
      registry.dispatch(
        keydown({
          altKey: true,
          code: 'KeyB',
          getModifierState: (modifier) => modifier === 'AltGraph',
          metaKey: true,
        }),
        true,
      ),
    ]).toEqual([true, false, false, false, false, true, true, true, true]);
    registry.setPlatform('non-mac');
    expect([
      registry.dispatch(keydown({ code: 'KeyK', ctrlKey: true }), true),
      registry.dispatch(keydown({ altKey: true, code: 'ArrowLeft' }), true),
    ]).toEqual([true, true]);
  });

  it.each([
    [{ code: 'KeyB', modifiers: ['primary', 'alt'] }, 'mac', '⌥⌘B'],
    [{ code: 'KeyB', modifiers: ['alt', 'primary'] }, 'non-mac', 'Ctrl+Alt+B'],
    [
      {
        mac: { code: 'BracketLeft', modifiers: ['primary'] },
        nonMac: { code: 'ArrowLeft', modifiers: ['alt'] },
      },
      'non-mac',
      'Alt+←',
    ],
    [{ code: 'Comma', modifiers: ['primary'] }, 'mac', '⌘,'],
  ] as const)('formats %j on %s', (shortcut, platform, expected) => {
    expect(formatKeyboardShortcut(shortcut, platform)).toBe(expected);
  });

  it('rejects consumed, composing, Process, and repeated events without suppression', () => {
    const registry = createKeyboardShortcutRegistry(false);
    const handler = vi.fn(trueFn);
    registry.register(binding({ handler }));
    registry.setPlatform('mac');

    const preventDefault = vi.fn();
    const stopImmediatePropagation = vi.fn();
    const events = [
      keydown({
        code: 'KeyK',
        defaultPrevented: true,
        metaKey: true,
        preventDefault,
        stopImmediatePropagation,
      }),
      keydown({
        code: 'KeyK',
        isComposing: true,
        metaKey: true,
        preventDefault,
        stopImmediatePropagation,
      }),
      keydown({
        code: 'KeyK',
        key: 'Process',
        metaKey: true,
        preventDefault,
        stopImmediatePropagation,
      }),
      keydown({
        code: 'KeyK',
        metaKey: true,
        preventDefault,
        repeat: true,
        stopImmediatePropagation,
      }),
    ];
    for (const event of events) {
      expect(registry.dispatch(event, true)).toBe(false);
    }
    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();

    const altGraph = vi.fn(trueFn);
    registry.register(
      binding({
        actionId: 'alt-graph',
        handler: altGraph,
        shortcut: { code: 'KeyB', modifiers: ['primary', 'alt'] },
      }),
    );
    registry.setPlatform('non-mac');
    expect(
      registry.dispatch(
        keydown({
          altKey: true,
          code: 'KeyB',
          ctrlKey: true,
          getModifierState: (modifier) => modifier === 'AltGraph',
        }),
        true,
      ),
    ).toBe(false);
    expect(altGraph).not.toHaveBeenCalled();
  });

  it('checks owners after matching and suppresses only a claimed collision', () => {
    const registry = createKeyboardShortcutRegistry(true);
    let currentOwner: Element | null = null;
    const getOwner = vi.fn(() => currentOwner);
    const order: string[] = [];
    let secondEnabled = false;
    const first = vi.fn(() => {
      order.push('first');
      secondEnabled = true;
      return false;
    });
    const disabled = vi.fn(trueFn);
    registry.register(binding({ actionId: 'disabled', handler: disabled, when: falseFn }));
    registry.register(binding({ actionId: 'first', handler: first, owner: getOwner }));
    registry.setPlatform('mac');
    expect(registry.dispatch(keydown({ code: 'KeyJ', metaKey: true }), true)).toBe(false);
    expect(getOwner).not.toHaveBeenCalled();
    for (currentOwner of [null, owner(false), owner(true, true)]) {
      expect(registry.dispatch(keydown({ code: 'KeyK', metaKey: true }), true)).toBe(false);
    }
    const ownerClosest = vi.fn(() => null);
    currentOwner = owner(true, false, ownerClosest);
    const unclaimedPreventDefault = vi.fn();
    const unclaimed = keydown({
      code: 'KeyK',
      metaKey: true,
      preventDefault: unclaimedPreventDefault,
    });
    expect(registry.dispatch(unclaimed, true)).toBe(false);
    expect(unclaimedPreventDefault).not.toHaveBeenCalled();

    registry.register(
      binding({
        actionId: 'second',
        handler: () => order.push('second') !== 0,
        when: () => secondEnabled,
      }),
    );
    const warning = vi.spyOn(console, 'warn').mockImplementation(noop);
    order.length = 0;
    secondEnabled = false;
    const claimedPreventDefault = vi.fn();
    const claimedStopImmediatePropagation = vi.fn();
    const claimed = keydown({
      code: 'KeyK',
      metaKey: true,
      preventDefault: claimedPreventDefault,
      stopImmediatePropagation: claimedStopImmediatePropagation,
    });
    expect(registry.dispatch(claimed, true)).toBe(true);
    expect(order).toEqual(['first', 'second']);
    expect(disabled).not.toHaveBeenCalled();
    expect(claimedPreventDefault).toHaveBeenCalledOnce();
    expect(claimedStopImmediatePropagation).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('first, second'));
    expect(ownerClosest).toHaveBeenCalledWith(
      '[inert], [aria-hidden="true"], [data-base-ui-inert]',
    );
  });

  it('allows semantic duplicate chords and rejects conflicting action chords', () => {
    const registry = createKeyboardShortcutRegistry(false);
    const register = (code: string, modifiers: ReadonlyArray<'primary' | 'alt'>) =>
      registry.register(binding({ actionId: 'shared', shortcut: { code, modifiers } }));
    const removeFirst = register('KeyK', ['primary', 'alt']);
    const removeSecond = register('KeyK', ['alt', 'primary', 'primary']);
    expect(() => register('KeyJ', ['primary', 'alt'])).toThrow(CONFLICTING_SHORTCUTS_PATTERN);
    removeFirst();
    removeFirst();
    expect(() => register('KeyJ', ['primary', 'alt'])).toThrow(CONFLICTING_SHORTCUTS_PATTERN);
    removeSecond();
    expect(() => register('KeyJ', ['primary', 'alt'])).not.toThrow();
  });

  it('publishes stable labels only when their effective values change', () => {
    const registry = createKeyboardShortcutRegistry(false);
    const listener = vi.fn();
    registry.subscribeLabels(listener);
    const removeFirst = registry.register(binding({ actionId: 'palette' }));
    registry.setPlatform('mac');
    const macLabels = registry.getLabelsSnapshot();
    expect(macLabels.get('palette')).toBe('⌘K');
    const removeSecond = registry.register(binding({ actionId: 'palette' }));
    expect(registry.getLabelsSnapshot()).toBe(macLabels);
    removeFirst();
    expect(registry.getLabelsSnapshot()).toBe(macLabels);
    expect(listener).toHaveBeenCalledOnce();
    registry.setPlatform('non-mac');
    expect(registry.getLabelsSnapshot().get('palette')).toBe('Ctrl+K');
    expect(listener).toHaveBeenCalledTimes(2);
    removeSecond();
    expect(registry.getLabelsSnapshot().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(3);

    const local = createKeyboardShortcutRegistry(false);
    const localListener = vi.fn();
    local.subscribeLabels(localListener);
    local.register(binding({ actionId: 'escape', shortcut: { key: 'Escape' } }));
    local.setPlatform('mac');
    const localLabels = local.getLabelsSnapshot();
    local.setPlatform('non-mac');
    expect(local.getLabelsSnapshot()).toBe(localLabels);
    expect(localListener).toHaveBeenCalledOnce();
  });
});
