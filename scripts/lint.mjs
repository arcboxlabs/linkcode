import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const eslintPackagePath = require.resolve('eslint/package.json');
const eslintCliPath = join(dirname(eslintPackagePath), 'bin', 'eslint.js');
const result = spawnSync(
  process.execPath,
  [
    '--max-old-space-size=8192',
    eslintCliPath,
    `--concurrency=${process.env.LINT_CONCURRENCY || 'off'}`,
    '--cache',
    '--cache-strategy=content',
    '--format=sukka',
    ...process.argv.slice(2),
    '.',
  ],
  { stdio: 'inherit', windowsHide: true },
);

if (result.error) {
  throw result.error;
}
if (result.signal) {
  process.kill(process.pid, result.signal);
} else {
  process.exitCode = result.status ?? 1;
}
