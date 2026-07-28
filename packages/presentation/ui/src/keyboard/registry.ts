export type KeyboardPlatform = 'mac' | 'non-mac';

export type KeyboardShortcutChord = (
  | { readonly key: string; readonly code?: never }
  | { readonly code: string; readonly key?: never }
) & { readonly modifiers?: ReadonlyArray<'primary' | 'alt' | 'shift'> };

export type KeyboardShortcut =
  | KeyboardShortcutChord
  | {
      readonly mac: KeyboardShortcutChord;
      readonly nonMac: KeyboardShortcutChord;
    };

export type KeyboardShortcuts = KeyboardShortcut | readonly KeyboardShortcut[];

export interface KeyboardShortcutRegistration {
  readonly actionId: string;
  readonly shortcut: KeyboardShortcuts;
  readonly owner: () => Element | null;
  readonly when?: (event: KeyboardEvent) => boolean;
  readonly handler: (event: KeyboardEvent) => boolean;
}

interface StoredRegistration extends Omit<KeyboardShortcutRegistration, 'shortcut'> {
  readonly shortcut: readonly KeyboardShortcut[];
}

const EMPTY_LABELS: ReadonlyMap<string, string> = new Map();
const KEY_CODE_PATTERN = /^Key[A-Z]$/;
const DIGIT_CODE_PATTERN = /^Digit\d$/;
const IS_DEVELOPMENT =
  (import.meta as ImportMeta & { readonly env?: { readonly DEV?: boolean } }).env?.DEV === true;

function shortcutList(shortcut: KeyboardShortcuts): readonly KeyboardShortcut[] {
  return Array.isArray(shortcut) ? shortcut : [shortcut as KeyboardShortcut];
}

function chordForPlatform(shortcut: KeyboardShortcut, platform: KeyboardPlatform) {
  return 'mac' in shortcut ? shortcut[platform === 'mac' ? 'mac' : 'nonMac'] : shortcut;
}

function hasModifier(chord: KeyboardShortcutChord, modifier: 'primary' | 'alt' | 'shift') {
  return chord.modifiers?.includes(modifier) === true;
}

function matchesChord(
  event: KeyboardEvent,
  chord: KeyboardShortcutChord,
  platform: KeyboardPlatform,
): boolean {
  if (chord.key === undefined ? event.code !== chord.code : event.key !== chord.key) return false;

  const primary = hasModifier(chord, 'primary');
  return (
    event.metaKey === (platform === 'mac' && primary) &&
    event.ctrlKey === (platform === 'non-mac' && primary) &&
    event.altKey === hasModifier(chord, 'alt') &&
    event.shiftKey === hasModifier(chord, 'shift')
  );
}

function matchesShortcut(
  event: KeyboardEvent,
  shortcuts: readonly KeyboardShortcut[],
  platform: KeyboardPlatform,
) {
  for (const shortcut of shortcuts) {
    if (matchesChord(event, chordForPlatform(shortcut, platform), platform)) return true;
  }
  return false;
}

function sameChord(left: KeyboardShortcutChord, right: KeyboardShortcutChord): boolean {
  return (
    left.key === right.key &&
    left.code === right.code &&
    hasModifier(left, 'primary') === hasModifier(right, 'primary') &&
    hasModifier(left, 'alt') === hasModifier(right, 'alt') &&
    hasModifier(left, 'shift') === hasModifier(right, 'shift')
  );
}

function sameShortcuts(left: readonly KeyboardShortcut[], right: readonly KeyboardShortcut[]) {
  return (
    left.length === right.length &&
    left.every(
      (shortcut, index) =>
        sameChord(chordForPlatform(shortcut, 'mac'), chordForPlatform(right[index], 'mac')) &&
        sameChord(chordForPlatform(shortcut, 'non-mac'), chordForPlatform(right[index], 'non-mac')),
    )
  );
}

export function isKeyboardShortcutLocalTarget(target: EventTarget | null): boolean {
  return (
    typeof Element !== 'undefined' &&
    target instanceof Element &&
    target.closest('[data-keyboard-shortcut-local]') !== null
  );
}

function isOwnerActive(owner: Element | null): boolean {
  return (
    owner !== null &&
    owner.isConnected &&
    owner.closest('[inert], [aria-hidden="true"], [data-base-ui-inert]') === null
  );
}

const KEY_LABELS: Readonly<Partial<Record<string, string>>> = {
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  Backquote: '`',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Equal: '=',
  Minus: '-',
  Period: '.',
  Quote: "'",
  Semicolon: ';',
  Slash: '/',
  ' ': 'Space',
};

function keyLabel(chord: KeyboardShortcutChord): string {
  const value = chord.key ?? chord.code;
  const label = KEY_LABELS[value];
  if (label !== undefined) return label;
  if (chord.code !== undefined && KEY_CODE_PATTERN.test(value)) return value.slice(3);
  if (chord.code !== undefined && DIGIT_CODE_PATTERN.test(value)) return value.slice(5);
  return value.length === 1 ? value.toUpperCase() : value;
}

function formatChord(chord: KeyboardShortcutChord, platform: KeyboardPlatform): string {
  const primary = hasModifier(chord, 'primary');
  const alt = hasModifier(chord, 'alt');
  const shift = hasModifier(chord, 'shift');
  if (platform === 'mac') {
    return `${alt ? '⌥' : ''}${shift ? '⇧' : ''}${primary ? '⌘' : ''}${keyLabel(chord)}`;
  }

  return `${primary ? 'Ctrl+' : ''}${alt ? 'Alt+' : ''}${shift ? 'Shift+' : ''}${keyLabel(chord)}`;
}

export function formatKeyboardShortcut(
  shortcut: KeyboardShortcuts,
  platform: KeyboardPlatform,
): string {
  return shortcutList(shortcut)
    .map((entry) => formatChord(chordForPlatform(entry, platform), platform))
    .join(' / ');
}

function sameLabels(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>) {
  if (left.size !== right.size) return false;
  for (const [actionId, label] of left) {
    if (right.get(actionId) !== label) return false;
  }
  return true;
}

export function createKeyboardShortcutRegistry(warnOnMultipleMatches = IS_DEVELOPMENT) {
  let platform: KeyboardPlatform | undefined;
  let labels: ReadonlyMap<string, string> = EMPTY_LABELS;
  const registrations: StoredRegistration[] = [];
  const labelListeners = new Set<() => void>();

  const refreshLabels = (): void => {
    const nextLabels = new Map<string, string>();
    if (platform !== undefined) {
      for (const registration of registrations) {
        nextLabels.set(
          registration.actionId,
          formatKeyboardShortcut(registration.shortcut, platform),
        );
      }
    }
    if (sameLabels(labels, nextLabels)) return;
    labels = nextLabels;
    for (const listener of labelListeners) listener();
  };

  const refreshActionLabel = (actionId: string): void => {
    const registration = registrations.find((candidate) => candidate.actionId === actionId);
    const nextLabel =
      registration === undefined || platform === undefined
        ? undefined
        : formatKeyboardShortcut(registration.shortcut, platform);
    if (nextLabel === labels.get(actionId) && (nextLabel !== undefined || !labels.has(actionId))) {
      return;
    }

    const nextLabels = new Map(labels);
    if (nextLabel === undefined) nextLabels.delete(actionId);
    else nextLabels.set(actionId, nextLabel);
    labels = nextLabels;
    for (const listener of labelListeners) listener();
  };

  const register = (binding: KeyboardShortcutRegistration): (() => void) => {
    const shortcut = shortcutList(binding.shortcut);
    const action = registrations.find((registration) => registration.actionId === binding.actionId);
    if (action !== undefined && !sameShortcuts(action.shortcut, shortcut)) {
      throw new Error(`Keyboard shortcut action "${binding.actionId}" has conflicting shortcuts`);
    }

    const registration = { ...binding, shortcut };
    registrations.push(registration);
    refreshActionLabel(binding.actionId);

    return () => {
      const index = registrations.indexOf(registration);
      if (index === -1) return;
      registrations.splice(index, 1);
      refreshActionLabel(binding.actionId);
    };
  };

  const isOwnerMatch = (
    registration: StoredRegistration,
    event: KeyboardEvent,
    currentPlatform: KeyboardPlatform,
  ): boolean =>
    matchesShortcut(event, registration.shortcut, currentPlatform) &&
    isOwnerActive(registration.owner());

  const dispatch = (event: KeyboardEvent, capture: boolean): boolean => {
    const currentPlatform = platform;
    if (
      currentPlatform === undefined ||
      event.defaultPrevented ||
      event.isComposing ||
      event.key === 'Process' ||
      (currentPlatform === 'non-mac' && event.getModifierState('AltGraph')) ||
      event.repeat
    ) {
      return false;
    }

    const primaryKey = currentPlatform === 'mac' ? event.metaKey : event.ctrlKey;
    if (capture !== (primaryKey || event.altKey)) return false;

    let claimed = false;
    let matches: string[] | undefined;
    for (const registration of registrations) {
      if (!isOwnerMatch(registration, event, currentPlatform)) continue;
      if (warnOnMultipleMatches) (matches ??= []).push(registration.actionId);
      if (claimed) continue;
      if (registration.when !== undefined && !registration.when(event)) continue;
      if (!registration.handler(event)) continue;
      if (!warnOnMultipleMatches) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
      }
      claimed = true;
    }
    if (matches !== undefined && matches.length > 1) {
      // eslint-disable-next-line no-console -- active shortcut collisions must be visible in development
      console.warn(
        `[LinkCode] keyboard shortcut matched multiple active actions; insertion order applies: ${matches.join(', ')}`,
      );
    }
    if (!claimed) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  };

  return {
    setPlatform(nextPlatform: KeyboardPlatform): void {
      if (platform === nextPlatform) return;
      platform = nextPlatform;
      refreshLabels();
    },
    register,
    dispatch,
    subscribeLabels(listener: () => void): () => void {
      labelListeners.add(listener);
      return () => labelListeners.delete(listener);
    },
    getLabelsSnapshot(): ReadonlyMap<string, string> {
      return labels;
    },
  };
}
