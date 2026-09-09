import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { env, platform } from 'node:process';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
// The packaged daemon's process.execPath is Electron; run the environment probe in its Node mode.
const CAPTURE_ENV = {
  ELECTRON_RUN_AS_NODE: '1',
  ELECTRON_NO_ATTACH_CONSOLE: '1',
  LINKCODE_RESOLVING_ENVIRONMENT: '1',
};
const FISH_SHELL_PATTERN = /(?:^|\/)fish$/;

const ShellEnvironmentSchema = z
  .record(z.string(), z.string())
  .refine((value) => Boolean(value.PATH), 'PATH is required');

export async function resolveAgentShellEnvironment(cwd: string): Promise<NodeJS.ProcessEnv> {
  if (platform !== 'darwin') return { ...env };
  return resolveShellEnvironment(cwd, env.SHELL ?? '/bin/bash', env);
}

export async function resolveShellEnvironment(
  cwd: string,
  shell: string,
  baseEnv: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  const marker = randomUUID().replaceAll('-', '');
  const expression = `"${marker}" + JSON.stringify(process.env) + "${marker}"`;
  const printEnv = `${quoteShellArg(process.execPath)} -p ${quoteShellArg(expression)}`;
  const command = shellProbeCommand(shell, printEnv);
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(shell, ['-i', '-l', '-c', command], {
      cwd,
      encoding: 'utf8',
      env: { ...baseEnv, ...CAPTURE_ENV },
      timeout: 60e3,
      windowsHide: true,
    }));
  } catch (error) {
    throw new Error(`Failed to load the project shell environment for ${cwd}`, { cause: error });
  }
  const resolved = parseShellEnvironment(stdout, marker, cwd);
  if (baseEnv.ELECTRON_RUN_AS_NODE === undefined) delete resolved.ELECTRON_RUN_AS_NODE;
  else resolved.ELECTRON_RUN_AS_NODE = baseEnv.ELECTRON_RUN_AS_NODE;
  if (baseEnv.ELECTRON_NO_ATTACH_CONSOLE === undefined) delete resolved.ELECTRON_NO_ATTACH_CONSOLE;
  else resolved.ELECTRON_NO_ATTACH_CONSOLE = baseEnv.ELECTRON_NO_ATTACH_CONSOLE;
  if (baseEnv.LINKCODE_RESOLVING_ENVIRONMENT === undefined) {
    delete resolved.LINKCODE_RESOLVING_ENVIRONMENT;
  } else {
    resolved.LINKCODE_RESOLVING_ENVIRONMENT = baseEnv.LINKCODE_RESOLVING_ENVIRONMENT;
  }
  return resolved;
}

/** fish rejects POSIX if/then/else — it alone gets its own syntax; every other login shell is POSIX. */
export function shellProbeCommand(shell: string, printEnv: string): string {
  if (FISH_SHELL_PATTERN.test(shell)) {
    return `if command -v direnv >/dev/null 2>&1; exec direnv exec "$PWD" ${printEnv}; else; exec ${printEnv}; end`;
  }
  return `if command -v direnv >/dev/null 2>&1; then exec direnv exec "$PWD" ${printEnv}; else exec ${printEnv}; fi`;
}

export function parseShellEnvironment(
  stdout: string,
  marker: string,
  cwd: string,
): NodeJS.ProcessEnv {
  const start = stdout.indexOf(marker);
  const end = stdout.indexOf(marker, start + marker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Project shell did not return an environment for ${cwd}`);
  }
  try {
    return ShellEnvironmentSchema.parse(JSON.parse(stdout.slice(start + marker.length, end)));
  } catch (error) {
    throw new Error(`Project shell returned an invalid environment for ${cwd}`, { cause: error });
  }
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}
