#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import process, { argv } from 'node:process';
/**
 * Post-pack assertions for the desktop release artifacts. Runs in CI right after
 * electron-builder (and locally: `node scripts/verify-artifacts.mts <mac|win|linux>` from
 * apps/desktop). Catches packaging regressions before they reach the update feed:
 *
 * - the per-arch artifact set is complete for the platform;
 * - every artifact name carries its arch. This is load-bearing for mac/win: electron-updater
 *   picks the feed entry whose filename contains process.arch and silently falls back to the
 *   FIRST entry otherwise, so an unsuffixed x64 name would hand x64 clients an arbitrary arch.
 *   Linux selects by per-arch channel file instead, so each channel must reference its own arch;
 * - every feed entry points at an existing file whose sha512 matches;
 * - the unpacked apps carry the bundled daemon (asar: out/daemon + migrations) and the PTY
 *   sidecar (Resources), so a build can never again ship a client with no host runtime (CODE-86/87).
 */
import { listPackage, statFile } from '@electron/asar';

const RELEASE_DIR = 'release';
const FEED_URL_LINE = /^ {2}- url: (.+)$/;
const FEED_SHA_LINE = /^ {4}sha512: (.+)$/;

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

interface PlatformExpectation {
  artifacts: string[];
  /** channel file -> arch markers whose entries the channel must carry. */
  feeds: Record<string, string[]>;
  /** Resources dir of each unpacked app, relative to the release dir. */
  resourceDirs: string[];
}

const EXPECTED: Partial<Record<string, PlatformExpectation>> = {
  mac: {
    artifacts: ['x64', 'arm64'].flatMap((arch) =>
      ['dmg', 'zip'].flatMap((ext) => [
        `LinkCode-${version}-${arch}.${ext}`,
        `LinkCode-${version}-${arch}.${ext}.blockmap`,
      ]),
    ),
    feeds: { 'latest-mac.yml': ['x64', 'arm64'] },
    resourceDirs: [
      'mac/LinkCode.app/Contents/Resources',
      'mac-arm64/LinkCode.app/Contents/Resources',
    ],
  },
  win: {
    artifacts: ['x64', 'arm64'].flatMap((arch) => [
      `LinkCode-${version}-${arch}.exe`,
      `LinkCode-${version}-${arch}.exe.blockmap`,
    ]),
    feeds: { 'latest.yml': ['x64', 'arm64'] },
    resourceDirs: ['win-unpacked/resources', 'win-arm64-unpacked/resources'],
  },
  linux: {
    // AppImage/deb use their ecosystems' arch names (x86_64/amd64); AppImage blockmaps are embedded.
    artifacts: [
      `LinkCode-${version}-x86_64.AppImage`,
      `LinkCode-${version}-arm64.AppImage`,
      `LinkCode-${version}-amd64.deb`,
      `LinkCode-${version}-arm64.deb`,
    ],
    // The channel files list deb alongside AppImage; x64 deb uses Debian's `amd64` name.
    feeds: { 'latest-linux.yml': ['x86_64', 'amd64'], 'latest-linux-arm64.yml': ['arm64'] },
    resourceDirs: ['linux-unpacked/resources', 'linux-arm64-unpacked/resources'],
  },
};

const SIDECAR_BINARY = argv[2] === 'win' ? 'linkcode-pty.exe' : 'linkcode-pty';
/** Paths inside app.asar that the daemon supervisor and its migrator depend on at runtime. */
const ASAR_HOST_RUNTIME = ['out/daemon/index.mjs', 'out/drizzle/meta/_journal.json'];
/**
 * Agent CLI platform packages must NOT ship (CODE-114): the daemon spawns a detected user
 * install or a managed download instead. These prefixes match only the platform-suffixed
 * binary packages — the SDK JS packages (`claude-agent-sdk`, `codex-sdk`) stay in the asar.
 */
const EXCLUDED_MODULE_PREFIXES = [
  'node_modules/@anthropic-ai/claude-agent-sdk-',
  'node_modules/@openai/codex-darwin-',
  'node_modules/@openai/codex-linux-',
  'node_modules/@openai/codex-win32-',
];
/**
 * Ceiling per shipped artifact. Normal artifacts sit at ~120–165 MB since agent binaries stopped
 * shipping (CODE-114); one reintroduced CLI adds ~66 MB compressed and trips this long before
 * users download it.
 */
const MAX_ARTIFACT_BYTES = 200 * 1024 * 1024;

/** The packed app must carry the host runtime: bundled daemon in the asar, sidecar beside it. */
function verifyHostRuntime(resourceDir: string, problems: string[]): void {
  const asarPath = join(RELEASE_DIR, resourceDir, 'app.asar');
  let missing = false;
  for (const inner of ASAR_HOST_RUNTIME) {
    try {
      // asar's lookup splits on the platform separator — normalize or Windows never matches.
      statFile(asarPath, inner.replaceAll('/', sep));
    } catch {
      missing = true;
      problems.push(`${resourceDir}/app.asar: missing ${inner}`);
      const unpacked = join(RELEASE_DIR, resourceDir, 'app.asar.unpacked', inner);
      if (existsSync(unpacked)) problems.push('  …but present in app.asar.unpacked (smartUnpack?)');
    }
  }
  // Diagnostics for the CI log: what did this asar actually get under out/?
  if (missing) {
    const outEntries = listPackage(asarPath, { isPack: false })
      .filter((entry) => entry.replaceAll('\\', '/').startsWith('/out/'))
      .slice(0, 40);
    console.error(`${resourceDir}/app.asar out/ contents (first 40):\n${outEntries.join('\n')}`);
  }
  if (!existsSync(join(RELEASE_DIR, resourceDir, SIDECAR_BINARY))) {
    problems.push(`${resourceDir}: missing PTY sidecar ${SIDECAR_BINARY}`);
  }
  verifyNoAgentBinaries(resourceDir, asarPath, problems);
}

/** The packed app must NOT carry agent CLI binaries — builtin shipping ended with CODE-114. */
function verifyNoAgentBinaries(resourceDir: string, asarPath: string, problems: string[]): void {
  if (existsSync(join(RELEASE_DIR, resourceDir, 'agent-bin'))) {
    problems.push(
      `${resourceDir}: agent-bin shipped — builtin agent binaries were removed (CODE-114)`,
    );
  }
  const shipped: string[] = [];
  for (const raw of listPackage(asarPath, { isPack: false })) {
    const normalized = raw.replaceAll('\\', '/');
    const entry = normalized[0] === '/' ? normalized.slice(1) : normalized;
    if (EXCLUDED_MODULE_PREFIXES.some((prefix) => entry.startsWith(prefix))) shipped.push(entry);
  }
  if (shipped.length > 0) {
    problems.push(
      `${resourceDir}/app.asar: agent platform packages shipped: ${shipped[0]} (+${shipped.length - 1} more)`,
    );
  }
  for (const prefix of EXCLUDED_MODULE_PREFIXES) {
    const dir = join(
      RELEASE_DIR,
      resourceDir,
      'app.asar.unpacked',
      ...prefix.split('/').slice(0, -1),
    );
    const base = prefix.split('/').at(-1)!;
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(base)) {
        problems.push(`${resourceDir}/app.asar.unpacked: agent platform package shipped: ${entry}`);
      }
    }
  }
}

interface FeedEntry {
  url: string;
  sha512: string;
}

/** electron-builder's feed ymls are flat generated documents; a scoped line scan beats a yaml dep. */
function parseFeedEntries(text: string): FeedEntry[] {
  const entries: FeedEntry[] = [];
  let current: FeedEntry | null = null;
  for (const line of text.split('\n')) {
    const url = FEED_URL_LINE.exec(line);
    const sha = FEED_SHA_LINE.exec(line);
    if (url) entries.push((current = { url: url[1].trim(), sha512: '' }));
    else if (sha && current) current.sha512 = sha[1].trim();
  }
  return entries;
}

function sha512(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')));
  });
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

async function verifyFeed(feed: string, archTokens: string[], problems: string[]): Promise<void> {
  const text = readOrNull(join(RELEASE_DIR, feed));
  if (text === null) {
    problems.push(`missing feed manifest: ${feed}`);
    return;
  }
  if (!text.includes(`version: ${version}`)) problems.push(`${feed}: version is not ${version}`);
  const entries = parseFeedEntries(text);
  if (entries.length === 0) problems.push(`${feed}: no file entries parsed`);
  for (const token of archTokens) {
    if (!entries.some((entry) => entry.url.includes(token))) {
      problems.push(`${feed}: no entry for arch "${token}"`);
    }
  }
  await Promise.all(
    entries.map(async (entry) => {
      if (!archTokens.some((token) => entry.url.includes(token))) {
        problems.push(
          `${feed}: entry "${entry.url}" carries no arch marker (updater would misroute)`,
        );
      }
      const actual = await sha512(join(RELEASE_DIR, entry.url)).catch(() => null);
      if (actual === null) {
        problems.push(`${feed}: entry "${entry.url}" does not exist on disk`);
      } else if (actual !== entry.sha512) {
        problems.push(`${feed}: sha512 mismatch for "${entry.url}"`);
      }
    }),
  );
}

async function main(): Promise<number> {
  const platform = argv[2];
  const expected = EXPECTED[platform];
  if (!expected) {
    console.error(`usage: verify-artifacts.mts <${Object.keys(EXPECTED).join('|')}>`);
    return 2;
  }

  const problems: string[] = [];
  for (const name of expected.artifacts) {
    let size: number;
    try {
      size = statSync(join(RELEASE_DIR, name)).size;
    } catch {
      problems.push(`missing artifact: ${name}`);
      continue;
    }
    if (!name.endsWith('.blockmap') && size > MAX_ARTIFACT_BYTES) {
      problems.push(
        `${name}: ${Math.round(size / 1e6)} MB exceeds the ${Math.round(MAX_ARTIFACT_BYTES / 1e6)} MB ceiling — agent binaries must not ship (CODE-114)`,
      );
    }
  }
  await Promise.all(
    Object.entries(expected.feeds).map(([feed, archTokens]) =>
      verifyFeed(feed, archTokens, problems),
    ),
  );
  for (const resourceDir of expected.resourceDirs) verifyHostRuntime(resourceDir, problems);

  if (problems.length > 0) {
    for (const problem of problems) console.error(`✗ ${problem}`);
    return 1;
  }
  console.log(
    `✓ ${platform}: ${expected.artifacts.length} artifacts + ${Object.keys(expected.feeds).length} feed manifest(s) + host runtime in ${expected.resourceDirs.length} app(s) verified`,
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
