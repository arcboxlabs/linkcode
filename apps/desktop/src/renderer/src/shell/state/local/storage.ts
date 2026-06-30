import { createLocalStorageState } from 'foxact/create-local-storage-state';
import { desktopShellStateModel } from './model';
import type { DesktopShellState } from './model';

const DESKTOP_SHELL_STORAGE_OPTIONS = {
  serializer: stringifyDesktopShellState,
  deserializer: parseDesktopShellStateJson,
};

export const [useDesktopShellState] = createLocalStorageState(
  desktopShellStateModel.storageKey,
  desktopShellStateModel.createDefault(),
  DESKTOP_SHELL_STORAGE_OPTIONS,
);

function stringifyDesktopShellState(state: DesktopShellState): string {
  return JSON.stringify(desktopShellStateModel.serialize(state));
}

function parseDesktopShellStateJson(raw: string): DesktopShellState {
  try {
    return desktopShellStateModel.parse(JSON.parse(raw));
  } catch {
    return desktopShellStateModel.createDefault();
  }
}
