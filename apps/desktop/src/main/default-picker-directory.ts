import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { DEFAULT_WORKSPACES_DIRNAME } from './constants';

/**
 * Default directory the native file/folder picker opens into (a visible `~/LinkCode`, created on
 * demand). Unrelated to `WorkspaceRecord` despite the naming overlap — purely a picker default path.
 */
export async function ensureDefaultPickerDirectory(): Promise<string> {
  const dir = join(app.getPath('home'), DEFAULT_WORKSPACES_DIRNAME);
  await mkdir(dir, { recursive: true });
  return dir;
}
