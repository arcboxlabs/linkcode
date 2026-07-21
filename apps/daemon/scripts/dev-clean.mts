import { rmSync } from 'node:fs';
import { databasePath, runtimeFilePath } from '../src/config';

// Resolves through config.ts so a fork's renamed STATE_DIR_BASENAME or an active
// LINKCODE_PROFILE cleans the same universe the dev daemon will actually use.
for (const path of [databasePath(), runtimeFilePath()]) rmSync(path, { force: true });
