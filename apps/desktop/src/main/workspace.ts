import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { APP_NAME } from './constants';

/**
 * The default workspace: a visible `~/LinkCode` folder the directory picker opens into, so agent
 * sessions land in one place by default. The user can still navigate elsewhere. Created on demand.
 */
export async function ensureDefaultWorkspace(): Promise<string> {
  const dir = join(app.getPath('home'), APP_NAME);
  await mkdir(dir, { recursive: true });
  return dir;
}
