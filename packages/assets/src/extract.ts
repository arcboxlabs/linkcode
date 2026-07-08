/// <reference types="node" />
import { execFile } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import type { ManagedAssetFormat } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { extract as tarExtract } from 'tar';
import { ExtractError, UnsupportedPlatformError } from './errors';

const execFileAsync = promisify(execFile);

/**
 * Single-member extraction: tgz goes through node-tar (pure JS — no system-tar assumption on
 * any platform). zip exists only for the tectonic win32 artifact and shells out to the system
 * bsdtar, which the OS guarantees where that artifact can run (System32 since Win10 1809;
 * macOS `tar` is bsdtar too, which keeps the branch testable on darwin). Extracting exactly
 * one declared member sidesteps zip-slip entirely.
 */
function zipTarBinary(): string {
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
  if (format === 'tgz') {
    try {
      await tarExtract({ file: archive, cwd: workDir }, [member]);
    } catch (error) {
      throw new ExtractError(`extracting ${member}: ${extractErrorMessage(error)}`, {
        cause: error,
      });
    }
  } else {
    try {
      await execFileAsync(zipTarBinary(), ['-xf', archive, '-C', workDir, member]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new UnsupportedPlatformError('system tar is unavailable for zip extraction', {
          cause: error,
        });
      }
      throw new ExtractError(`extracting ${member}: ${extractErrorMessage(error)}`, {
        cause: error,
      });
    }
  }
  const extracted = join(workDir, member);
  if (!existsSync(extracted)) throw new ExtractError(`member ${member} missing from archive`);
  renameSync(extracted, destFile);
  posixChmod(destFile);
}

function posixChmod(file: string): void {
  if (process.platform !== 'win32') chmodSync(file, 0o755);
}
