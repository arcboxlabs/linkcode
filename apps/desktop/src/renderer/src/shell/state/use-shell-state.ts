import { useLocalStorage } from 'foxact/use-local-storage';
import { useEffect } from 'react';
import {
  DESKTOP_SHELL_STORAGE_KEY,
  clearLegacyDesktopShellState,
  createDefaultDesktopShellState,
  parseDesktopShellState,
  serializeShellState,
} from './shell-state';
import type { DesktopShellState } from './shell-state';

const DEFAULT_DESKTOP_SHELL_STATE = createDefaultDesktopShellState();
const DESKTOP_SHELL_STORAGE_OPTIONS = {
  serializer: serializeDesktopShellState,
  deserializer: deserializeDesktopShellState,
};

export function useDesktopShellState() {
  useEffect(() => {
    clearLegacyDesktopShellState();
  }, []);

  return useLocalStorage(
    DESKTOP_SHELL_STORAGE_KEY,
    DEFAULT_DESKTOP_SHELL_STATE,
    DESKTOP_SHELL_STORAGE_OPTIONS,
  );
}

function serializeDesktopShellState(state: DesktopShellState): string {
  return JSON.stringify(serializeShellState(state));
}

function deserializeDesktopShellState(raw: string): DesktopShellState {
  try {
    return parseDesktopShellState(JSON.parse(raw));
  } catch {
    return createDefaultDesktopShellState();
  }
}
