/// <reference types="node" />
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const RE_GIT_SHA = /^[0-9a-f]{40}$/;

export interface RenderCommandResult {
  readonly stdout: string;
}

export type RenderCommandRunner = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string },
) => Promise<RenderCommandResult>;

export const defaultRenderCommandRunner: RenderCommandRunner = async (command, args, options) => {
  const { stdout } = await execFileAsync(command, [...args], {
    cwd: options.cwd,
    windowsHide: true,
  });
  return { stdout };
};

/** The publisher CLI must exist inside the checkout — builds never fall back to a stale or
 * global publisher install. */
export async function assertPublisherCheckout(
  dir: string,
  pinnedSha: string,
  scriptPath: string,
): Promise<void> {
  try {
    const stats = await stat(join(dir, scriptPath));
    if (!stats.isFile()) throw new Error('not a file');
  } catch {
    throw new Error(
      `Config publisher checkout not found at ${dir} (expected ${scriptPath} inside). ` +
        `Check out the config publisher at commit ${pinnedSha} and pass its root explicitly; ` +
        'builds never fall back to a stale or global publisher install',
    );
  }
}

/** Rendered output must come from the pinned commit only: exact HEAD, no local modifications. */
export async function verifyPinnedCheckout(
  dir: string,
  pinnedSha: string,
  label: string,
  run: RenderCommandRunner,
): Promise<void> {
  let head: string;
  try {
    head = (await run('git', ['-C', dir, 'rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
  } catch {
    throw new Error(`${label} checkout at ${dir} is not a git checkout`);
  }
  if (head !== pinnedSha) {
    throw new Error(
      `${label} checkout at ${dir} is at commit ${head}, but this build pins ${pinnedSha}; ` +
        'check out the pinned commit and retry',
    );
  }
  const status = (
    await run('git', ['-C', dir, 'status', '--porcelain'], { cwd: dir })
  ).stdout.trim();
  if (status.length > 0) {
    throw new Error(
      `${label} checkout at ${dir} has local modifications; ` +
        'rendered output must come from the pinned commit only',
    );
  }
}
