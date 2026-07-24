import type { ManagedAssetFormat, ManagedAssetId } from '@linkcode/schema';
import { managedAgentAssetId, managedAssetIdEquals, managedToolAssetId } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import type { NpmClosure } from './closure';
import { PI_CLOSURE } from './pi-closure.gen';
import type { PlatformKey } from './platform';

/**
 * Asset declarations, empirically pinned 2026-07-08: npm member paths and platform naming were
 * read off real registry tarballs, tectonic URLs/digests off the GitHub release API. Assets
 * differ only in version policy, per-platform source, and archive layout — downstream machinery
 * is shared.
 */

/** How an asset's wanted version is decided. */
export type VersionPolicy =
  /** The installed carrier package's own version (platform artifacts are pinned to the same). */
  | { kind: 'sdk-version'; package: string }
  /** A catalog constant, until the compat manifest (CODE-77) serves recommendations. */
  | { kind: 'pinned'; version: string };

/** Where one platform's artifact comes from. */
export type ArtifactSource =
  | {
      kind: 'npm';
      packageName: string;
      /** Maps the asset version to the registry version key (codex platform builds live as `<ver>-<platform>` versions of `@openai/codex`). */
      versionKey?: (version: string) => string;
      member: string;
      /** Extra members installed as executable siblings under their basenames (see `ManagedAssetArtifact`). */
      extraMembers?: string[];
      format: 'tgz';
    }
  | {
      kind: 'baked';
      url: string;
      /** SRI digest, hand-verified at authoring time (the interim trust root until CODE-77). */
      integrity: string;
      size: number;
      member: string;
      /** Extra members installed as executable siblings under their basenames (see `ManagedAssetArtifact`). */
      extraMembers?: string[];
      format: ManagedAssetFormat;
    };

export interface BinaryAssetDescriptor {
  id: ManagedAssetId;
  /** Executable base name inside the installed version dir (`.exe` appended on win32). */
  binaryBase: string;
  version: VersionPolicy;
  /** Per-platform source; an absent key means the asset does not support that platform. */
  artifacts: Partial<Record<PlatformKey, ArtifactSource>>;
}

/**
 * An in-process npm tree (pi, CODE-219): installed as a whole `node_modules` layout the daemon
 * imports, never spawns. The closure manifest is generated from pnpm-lock.yaml at build time.
 */
export interface NpmClosureAssetDescriptor {
  id: ManagedAssetId;
  version: VersionPolicy;
  closure: NpmClosure;
}

export type AssetDescriptor = BinaryAssetDescriptor | NpmClosureAssetDescriptor;

export function isClosureDescriptor(
  descriptor: AssetDescriptor,
): descriptor is NpmClosureAssetDescriptor {
  return 'closure' in descriptor;
}

const PLATFORM_KEYS: PlatformKey[] = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
];

function exe(key: PlatformKey): string {
  return key.startsWith('win32') ? '.exe' : '';
}

function forAllPlatforms(source: (key: PlatformKey) => ArtifactSource) {
  return Object.fromEntries(PLATFORM_KEYS.map((key) => [key, source(key)])) as Record<
    PlatformKey,
    ArtifactSource
  >;
}

/** Rust target triples embedded in the codex tarball's `vendor/` tree, per platform. */
const CODEX_TRIPLES: Record<PlatformKey, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
};

const TECTONIC_VERSION = '0.16.9';
const TECTONIC_RELEASE = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic@${TECTONIC_VERSION}`;

function tectonicArtifact(
  triple: string,
  format: ManagedAssetFormat,
  integrity: string,
  size: number,
): ArtifactSource {
  const ext = format === 'zip' ? 'zip' : 'tar.gz';
  return {
    kind: 'baked',
    url: `${TECTONIC_RELEASE}/tectonic-${TECTONIC_VERSION}-${triple}.${ext}`,
    integrity,
    size,
    member: format === 'zip' ? 'tectonic.exe' : 'tectonic',
    format,
  };
}

// The first-party Anthropic⇄OpenAI translation sidecar (CODE-133). GitHub-release binaries; digests
// hand-verified against the downloaded v0.5.0-rc2 assets (2026-07-09). No win32-arm64 build (like tectonic).
const AIGATEWAY_VERSION = '0.5.0-rc2';
const AIGATEWAY_RELEASE = `https://github.com/arcboxlabs/aigateway/releases/download/v${AIGATEWAY_VERSION}`;

function aigatewayArtifact(
  triple: string,
  format: ManagedAssetFormat,
  integrity: string,
  size: number,
): ArtifactSource {
  const ext = format === 'zip' ? 'zip' : 'tar.gz';
  return {
    kind: 'baked',
    url: `${AIGATEWAY_RELEASE}/aigateway-${AIGATEWAY_VERSION}-${triple}.${ext}`,
    integrity,
    size,
    member: format === 'zip' ? 'aigateway.exe' : 'aigateway',
    format,
  };
}

export const CATALOG: readonly AssetDescriptor[] = [
  {
    id: managedAgentAssetId('claude-code'),
    binaryBase: 'claude',
    version: { kind: 'sdk-version', package: '@anthropic-ai/claude-agent-sdk' },
    // Defaults to the glibc builds (matching the SDK's own resolution over -musl variants).
    // Proprietary license: these URLs must always point at the npm registry, never a mirror.
    artifacts: forAllPlatforms((key) => ({
      kind: 'npm',
      packageName: `@anthropic-ai/claude-agent-sdk-${key}`,
      member: `package/claude${exe(key)}`,
      format: 'tgz',
    })),
  },
  {
    id: managedAgentAssetId('codex'),
    binaryBase: 'codex',
    // codex has no JS SDK since the app-server rewrite; the installed `@openai/codex` meta
    // package (the CLI carrier agent-adapter depends on) is the pair version source.
    version: { kind: 'sdk-version', package: '@openai/codex' },
    // `@openai/codex-<platform>` package names are npm aliases that 404 on the registry; the
    // real versions live under `@openai/codex` with a platform-suffixed version key. The bare
    // binary spawns fine without its vendored rg/zsh siblings (drift smoke, 2026-07-08) — but
    // on Windows the CLI resolves its sandbox helpers strictly next to its own binary (direct
    // sibling or `codex-resources/`, no PATH search) and an unresolved helper surfaces as a
    // shell error dialog, so those two ship alongside (members verified against the real
    // 0.144.1 win32 tarballs, 2026-07-17).
    artifacts: forAllPlatforms((key) => ({
      kind: 'npm',
      packageName: '@openai/codex',
      versionKey: (version: string) => `${version}-${key}`,
      member: `package/vendor/${CODEX_TRIPLES[key]}/bin/codex${exe(key)}`,
      ...(key.startsWith('win32') && {
        extraMembers: [
          `package/vendor/${CODEX_TRIPLES[key]}/codex-resources/codex-windows-sandbox-setup.exe`,
          `package/vendor/${CODEX_TRIPLES[key]}/codex-resources/codex-command-runner.exe`,
        ],
      }),
      format: 'tgz',
    })),
  },
  {
    id: managedAgentAssetId('pi'),
    // Resolvable only in dev/standalone hosts (packaged apps exclude the closure from
    // node_modules); the manager falls back to the manifest's own version there.
    version: { kind: 'sdk-version', package: '@earendil-works/pi-coding-agent' },
    closure: PI_CLOSURE,
  },
  {
    id: managedAgentAssetId('opencode'),
    binaryBase: 'opencode',
    version: { kind: 'sdk-version', package: '@opencode-ai/sdk' },
    // opencode names its platform packages `windows`, not node's `win32`.
    artifacts: forAllPlatforms((key) => ({
      kind: 'npm',
      packageName: `opencode-${key.replace('win32', 'windows')}`,
      member: `package/bin/opencode${exe(key)}`,
      format: 'tgz',
    })),
  },
  {
    id: managedToolAssetId('tectonic'),
    binaryBase: 'tectonic',
    version: { kind: 'pinned', version: TECTONIC_VERSION },
    // Static musl builds on linux (no glibc floor); no arm64 windows build exists.
    artifacts: {
      'darwin-arm64': tectonicArtifact(
        'aarch64-apple-darwin',
        'tgz',
        'sha256-7bZ8YaunaCifbaRByeb1I8+v9PiypXCFI+8pxUP46I4=',
        20_590_132,
      ),
      'darwin-x64': tectonicArtifact(
        'x86_64-apple-darwin',
        'tgz',
        'sha256-ediDn6NZS/6psr8qwKBFW8xNDelWpeXEAxB+mnL3noY=',
        20_572_838,
      ),
      'linux-arm64': tectonicArtifact(
        'aarch64-unknown-linux-musl',
        'tgz',
        'sha256-+ao5AX29UfER/bk92iIheMvlHIGTUI/FZ7UjzHT/+cE=',
        9_923_433,
      ),
      'linux-x64': tectonicArtifact(
        'x86_64-unknown-linux-musl',
        'tgz',
        'sha256-YLE6CCauetnONLSi3wa/8s/Ppt2oqRVHfAy7hOGkqQI=',
        10_146_030,
      ),
      'win32-x64': tectonicArtifact(
        'x86_64-pc-windows-msvc',
        'zip',
        'sha256-ExokYEeFqWAJiaPZEiX1l99SrAbwCu/+hv1Sn5nuXN0=',
        20_035_039,
      ),
    },
  },
  {
    id: managedToolAssetId('aigateway'),
    binaryBase: 'aigateway',
    version: { kind: 'pinned', version: AIGATEWAY_VERSION },
    // Static musl builds on linux; no arm64 windows build.
    artifacts: {
      'darwin-arm64': aigatewayArtifact(
        'aarch64-apple-darwin',
        'tgz',
        'sha256-7dF2X2fZOEDlzow1+Vodu9T+XGfyEmOtW/5M+/xQYq4=',
        3_404_002,
      ),
      'darwin-x64': aigatewayArtifact(
        'x86_64-apple-darwin',
        'tgz',
        'sha256-QUG0Ayw9U0Xr8LoBNP3JJtBHq8ohFGScEUoA0jTcebA=',
        3_612_759,
      ),
      'linux-arm64': aigatewayArtifact(
        'aarch64-unknown-linux-musl',
        'tgz',
        'sha256-FeW0CEd1hwoBu91y/1Uc/ZoK+crcXGoq3zDsPa/5xYQ=',
        3_479_607,
      ),
      'linux-x64': aigatewayArtifact(
        'x86_64-unknown-linux-musl',
        'tgz',
        'sha256-fAJd9IRBFOqLf5uhNkoPGMdO2KTuycNh0niZ7ian4Fk=',
        3_769_337,
      ),
      'win32-x64': aigatewayArtifact(
        'x86_64-pc-windows-msvc',
        'zip',
        'sha256-440fIMPnL+5+kp142ffRzTq+XKsOeTU5RljnOnG0ubQ=',
        3_759_629,
      ),
    },
  },
];

export function descriptorFor(id: ManagedAssetId): AssetDescriptor {
  return nullthrow(
    CATALOG.find((candidate) => managedAssetIdEquals(candidate.id, id)),
    `Unknown managed asset: ${id.kind}:${id.name}`,
  );
}
