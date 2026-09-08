import { rmSync } from 'node:fs';
import { databasePath, runtimeFilePath } from '../src/config';

// Resolves through config.ts so a fork's renamed state dir, the resolved channel, or an active
// LINKCODE_PROFILE cleans the same universe the dev daemon will actually use.
const devStatePaths = [databasePath(), runtimeFilePath()];
for (let i = 0, len = devStatePaths.length; i < len; i++) {
  const path = devStatePaths[i];
  rmSync(path, { force: true });
}
