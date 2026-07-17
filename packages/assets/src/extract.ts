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
 * Single-member extraction: tgz via node-tar (pure JS, no system-tar assumption); zip (tectonic
 * win32 only) shells out to system bsdtar (System32 since Win10 1809; macOS tar is bsdtar, so
 * the branch is testable on darwin). Extracting exactly one declared member sidesteps zip-slip.
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

/**
 * Extract a whole npm package tarball into `destDir`, stripping the tarball's root directory
 * (`package/` on npm-published tarballs; `strip` handles legacy roots too). node-tar refuses
 * absolute and `..` paths by default, so a hostile archive cannot escape `destDir`.
 */
export async function extractPackageTree(archive: string, destDir: string): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  try {
    await tarExtract({ file: archive, cwd: destDir, strip: 1 });
  } catch (error) {
    throw new ExtractError(
      `extracting package tree from ${archive}: ${extractErrorMessage(error)}`,
      {
        cause: error,
      },
    );
  }
}

function posixChmod(file: string): void {
  if (process.platform !== 'win32') chmodSync(file, 0o755);
}
