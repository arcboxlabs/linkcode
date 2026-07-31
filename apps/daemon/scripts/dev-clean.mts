import { rmSync } from 'node:fs';
import { databasePath, runtimeFilePath } from '../src/config';

// Resolves through config.ts so a fork's renamed state dir, the resolved channel, or an active
// LINKCODE_PROFILE cleans the same universe the dev daemon will actually use.
const paths = [databasePath(), runtimeFilePath()];
for (let i = 0, len = paths.length; i < len; i++) rmSync(paths[i], { force: true });
