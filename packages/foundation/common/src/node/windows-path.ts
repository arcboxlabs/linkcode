/// <reference types="node" />

/**
 * Claude Code on Windows routes every shell command through Git Bash and rewrites Windows paths
 * into the MSYS spelling (`C:\Users\foo` → `/c/Users/foo`), so agent-reported tool inputs (and
 * client requests echoing them) can carry paths win32 Node cannot resolve: `path.resolve` reads
 * the rooted POSIX form as drive-relative and fabricates `C:\c\Users\foo`. The regexes and
 * replacement mirror Claude Code's own `posixPathToWindowsPath` (`src/utils/windowsPaths.ts`);
 * its UNC and bare slash-flip branches are deliberately dropped — win32 Node already resolves
 * `//server/share` and forward slashes, so only the drive spellings need rewriting.
 */

const CYGDRIVE_PATH = /^\/cygdrive\/([a-z])(?:\/|$)/i;
const MSYS_DRIVE_PATH = /^\/([a-z])(?:\/|$)/i;

/** Rewrite an MSYS/Cygwin drive-form path (`/c/…`, `/cygdrive/c/…`) to native Windows form
 * (`C:\…`); every other shape passes through untouched. */
export function windowsPathFromPosix(path: string): string {
  const cygdrive = CYGDRIVE_PATH.exec(path);
  if (cygdrive) {
    const rest = path.slice('/cygdrive/'.length + 1);
    return `${cygdrive[1].toUpperCase()}:${(rest || '\\').replaceAll('/', '\\')}`;
  }
  const drive = MSYS_DRIVE_PATH.exec(path);
  if (drive) {
    const rest = path.slice(2);
    return `${drive[1].toUpperCase()}:${(rest || '\\').replaceAll('/', '\\')}`;
  }
  return path;
}

/** {@link windowsPathFromPosix} on a win32 daemon; identity elsewhere, where `/c/…` is a real
 * POSIX path that must not be touched. */
export function toHostPath(path: string): string {
  return process.platform === 'win32' ? windowsPathFromPosix(path) : path;
}
