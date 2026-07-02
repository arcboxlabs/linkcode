import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { APP_NAME } from './constants';

/**
 * The default directory the native file/folder picker opens into: a visible `~/LinkCode` folder,
 * so agent sessions land in one place by default. The user can still navigate elsewhere. Created
 * on demand. Unrelated to `WorkspaceRecord` (the registered-directory identity in `@linkcode/schema`)
 * despite the naming overlap — this is purely a picker-dialog default path.
 */
export async function ensureDefaultPickerDirectory(): Promise<string> {
  const dir = join(app.getPath('home'), APP_NAME);
  await mkdir(dir, { recursive: true });
  return dir;
}
