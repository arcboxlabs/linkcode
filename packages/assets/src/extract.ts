/// <reference types="node" />
import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import type { ManagedAssetFormat } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { ExtractError, UnsupportedPlatformError } from './errors';

const execFileAsync = promisify(execFile);

/**
 * Single-member extraction via the system `tar`: bsdtar on macOS and Windows (bundled since
 * Win10 1809; reads zip too), GNU tar on linux — our linux artifacts are always `.tar.gz`.
 * Extracting exactly one declared member sidesteps zip-slip entirely. On win32 tar is invoked
 * by absolute System32 path so a polluted PATH cannot substitute it.
 */
function tarBinary(): string {
  if (process.platform !== 'win32') return 'tar';
  return join(process.env.SystemRoot ?? String.raw`C:\Windows`, 'System32', 'tar.exe');
}

/** Extract `member` out of `archive` to exactly `destFile` (creating its parent), 0o755 on posix. */
export async function extractMember(
  archive: string,
  format: ManagedAssetFormat,
  member: string | undefined,
  destFile: string,
): Promise<void> {
  mkdirSync(dirname(destFile), { recursive: true });
  if (format === 'raw') {
    copyFileSync(archive, destFile);
    posixChmod(destFile);
    return;
  }
  if (!member) throw new ExtractError(`no archive member declared for ${archive}`);
  const workDir = dirname(archive);
  const flags = format === 'zip' ? '-xf' : '-xzf';
  try {
    await execFileAsync(tarBinary(), [flags, archive, '-C', workDir, member]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new UnsupportedPlatformError('system tar is unavailable', { cause: error });
    }
    throw new ExtractError(`extracting ${member}: ${extractErrorMessage(error)}`, { cause: error });
  }
  const extracted = join(workDir, member);
  if (!existsSync(extracted)) throw new ExtractError(`member ${member} missing from archive`);
  renameSync(extracted, destFile);
  posixChmod(destFile);
}

function posixChmod(file: string): void {
  if (process.platform !== 'win32') chmodSync(file, 0o755);
}
