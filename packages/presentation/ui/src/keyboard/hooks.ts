import { useEffect } from 'foxact/use-abortable-effect';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { useStableHandler } from 'foxact/use-stable-handler-only-when-you-know-what-you-are-doing-or-you-will-be-fired';
import { useEffectEvent, useSyncExternalStore } from 'react';
import type { KeyboardPlatform, KeyboardShortcuts } from './registry';
import { createKeyboardShortcutRegistry } from './registry';

const keyboardShortcutRegistry = createKeyboardShortcutRegistry();

export interface KeyboardShortcutBinding {
  readonly actionId: string;
  readonly shortcut: KeyboardShortcuts;
  readonly owner: React.RefObject<Element | null>;
  readonly when?: (event: KeyboardEvent) => boolean;
  readonly handler: (event: KeyboardEvent) => boolean;
}

export function setKeyboardShortcutPlatform(platform: KeyboardPlatform): void {
  keyboardShortcutRegistry.setPlatform(platform);
}

export function useKeyboardShortcutListener(): void {
  useEffect((signal) => {
    const capture = (event: KeyboardEvent): void => {
      keyboardShortcutRegistry.dispatch(event, true);
    };
    const bubble = (event: KeyboardEvent): void => {
      keyboardShortcutRegistry.dispatch(event, false);
    };
    window.addEventListener('keydown', capture, { capture: true, signal });
    window.addEventListener('keydown', bubble, { signal });
  }, []);
}

export function useKeyboardShortcut(binding: KeyboardShortcutBinding): void {
  const handler = useStableHandler(binding.handler);
  const when = useEffectEvent((event: KeyboardEvent) => binding.when?.(event) ?? true);
  const { actionId, owner, shortcut } = binding;

  useLayoutEffect(
    () =>
      keyboardShortcutRegistry.register({
        actionId,
        handler,
        owner: () => owner.current,
        shortcut,
        when,
      }),
    [actionId, handler, owner, shortcut],
  );
}

function subscribeLabels(listener: () => void): () => void {
  return keyboardShortcutRegistry.subscribeLabels(listener);
}

function getLabelsSnapshot(): ReadonlyMap<string, string> {
  return keyboardShortcutRegistry.getLabelsSnapshot();
}

export function useKeyboardShortcutLabels(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribeLabels, getLabelsSnapshot, getLabelsSnapshot);
}

export function useKeyboardShortcutLabel(actionId: string): string | undefined {
  const getLabelSnapshot = (): string | undefined =>
    keyboardShortcutRegistry.getLabelsSnapshot().get(actionId);
  return useSyncExternalStore(subscribeLabels, getLabelSnapshot, getLabelSnapshot);
}
