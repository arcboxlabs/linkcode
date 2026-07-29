import { execFile } from 'node:child_process';
import { env, platform } from 'node:process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ENV_MARKER = '\u{1E}LINKCODE_ENV\u{1F}';
const PRINT_ENV = String.raw`printf '\036LINKCODE_ENV\037'; exec /usr/bin/env -0`;
const LOAD_ENV = `if command -v direnv >/dev/null 2>&1; then exec direnv exec "$PWD" /bin/sh -c "${PRINT_ENV}"; else ${PRINT_ENV}; fi`;

export async function resolveAgentProcessEnvironment(cwd: string): Promise<NodeJS.ProcessEnv> {
  if (platform !== 'darwin') return { ...env };
  return resolveShellEnvironment(cwd, env.SHELL ?? '/bin/bash', env);
}

export async function resolveShellEnvironment(
  cwd: string,
  shell: string,
  baseEnv: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(shell, ['-ilc', LOAD_ENV], {
      cwd,
      encoding: 'utf8',
      env: baseEnv,
      timeout: 60e3,
      windowsHide: true,
    }));
  } catch (error) {
    throw new Error(`Failed to load the project shell environment for ${cwd}`, { cause: error });
  }
  return parseShellEnvironment(stdout, cwd);
}

export function parseShellEnvironment(stdout: string, cwd: string): NodeJS.ProcessEnv {
  const marker = stdout.lastIndexOf(ENV_MARKER);
  if (marker < 0) throw new Error(`Project shell did not return an environment for ${cwd}`);

  const resolved: NodeJS.ProcessEnv = {};
  for (const entry of stdout.slice(marker + ENV_MARKER.length).split('\0')) {
    if (entry === '') continue;
    const separator = entry.indexOf('=');
    if (separator < 1) {
      throw new Error(`Project shell returned an invalid environment for ${cwd}`);
    }
    resolved[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  if (!resolved.PATH) throw new Error(`Project shell returned no PATH for ${cwd}`);
  return resolved;
}
