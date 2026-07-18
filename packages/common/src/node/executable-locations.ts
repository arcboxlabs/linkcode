import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

/**
 * Where a user-installed CLI may live, for daemons that cannot trust their inherited PATH.
 * Extracted from the agent runtime probe (CODE-220) so non-agent CLIs (e.g. `gh`, CODE-271)
 * resolve with the same semantics. `binary` is the exact filename including any platform
 * suffix (`.exe` on win32) — spawning by absolute path bypasses PATHEXT.
 */

/**
 * Candidate paths from the process's own PATH, searched ahead of the fallback locations
 * (CODE-220): PATH is the user's declared resolution order, and its order decides which of
 * several installs wins. Deriving candidates executes nothing, so only entries that don't
 * denote a fixed location are dropped: relative and empty segments (both resolve against
 * the process's incidental cwd).
 */
function pathInstallLocations(binary: string): string[] {
  const locations: string[] = [];
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    // Windows PATH entries with spaces are conventionally double-quoted.
    const dir = entry.replaceAll('"', '');
    if (dir.length > 0 && isAbsolute(dir)) locations.push(join(dir, binary));
  }
  return locations;
}

/**
 * Fallback absolute install locations, probed after the PATH scan for daemons whose PATH was
 * stripped by a GUI launch (macOS launchd passes only `/usr/bin:/bin:/usr/sbin:/sbin`).
 * win32 has no entries: Windows GUI processes inherit the registry-composed user PATH, which
 * installers (winget Links, claude's `%USERPROFILE%\.local\bin`, scoop shims) join by design,
 * so the PATH scan already covers them.
 */
function fallbackInstallLocations(binary: string): string[] {
  const home = homedir();
  switch (process.platform) {
    case 'darwin':
      // Official installers target ~/.local/bin; Homebrew is /opt/homebrew (arm) or /usr/local (intel).
      return [
        join(home, '.local', 'bin', binary),
        join('/opt/homebrew/bin', binary),
        join('/usr/local/bin', binary),
      ];
    case 'linux':
      // /usr/bin is where distro packages land (e.g. Arch's codex).
      return [
        join(home, '.local', 'bin', binary),
        join('/home/linuxbrew/.linuxbrew/bin', binary),
        join('/usr/local/bin', binary),
        join('/usr/bin', binary),
      ];
    default:
      return [];
  }
}

/** Deduped candidate paths for `binary`: PATH scan first (user-declared precedence), then the
 * per-platform fallback install locations. Existence is the caller's check — deriving the list
 * stats nothing and executes nothing. */
export function executableSearchLocations(binary: string): string[] {
  return [...new Set([...pathInstallLocations(binary), ...fallbackInstallLocations(binary)])];
}
