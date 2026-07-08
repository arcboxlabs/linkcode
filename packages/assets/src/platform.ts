import process from 'node:process';

/** The platform×arch grid the catalog can describe. */
export type PlatformKey =
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'linux-arm64'
  | 'linux-x64'
  | 'win32-arm64'
  | 'win32-x64';

const SUPPORTED: ReadonlySet<string> = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
] satisfies PlatformKey[]);

/** The running host's platform key; undefined on combinations the catalog does not describe. */
export function currentPlatformKey(): PlatformKey | undefined {
  const key = `${process.platform}-${process.arch}`;
  return SUPPORTED.has(key) ? (key as PlatformKey) : undefined;
}
