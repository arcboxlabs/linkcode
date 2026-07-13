import type { ManagedAssetFormat, ManagedAssetId } from '@linkcode/schema';
import type { PlatformKey } from './platform';

/**
 * The first-batch asset declarations. Everything empirically pinned 2026-07-08: codex vendor
 * triples and opencode's `windows` (not `win32`) naming were read off the real registry
 * tarballs; tectonic URLs/digests come from the GitHub release API (`digest` field verified
 * against a downloaded asset). Assets differ only in version policy, per-platform source, and
 * archive layout — the machinery downstream is shared.
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
      format: 'tgz';
    }
  | {
      kind: 'baked';
      url: string;
      /** SRI digest, hand-verified at authoring time (the interim trust root until CODE-77). */
      integrity: string;
      size: number;
      member: string;
      format: ManagedAssetFormat;
    };

export interface AssetDescriptor {
  id: ManagedAssetId;
  /** Executable base name inside the installed version dir (`.exe` appended on win32). */
  binaryBase: string;
  version: VersionPolicy;
  /** Per-platform source; an absent key means the asset does not support that platform. */
  artifacts: Partial<Record<PlatformKey, ArtifactSource>>;
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

export const CATALOG: Record<ManagedAssetId, AssetDescriptor> = {
  'agent:claude-code': {
    id: 'agent:claude-code',
    binaryBase: 'claude',
    version: { kind: 'sdk-version', package: '@anthropic-ai/claude-agent-sdk' },
    // The SDK also publishes -musl linux variants; like the SDK's own resolution we default
    // to the glibc builds. Proprietary license: these URLs must always point at the npm
    // registry, never a mirror.
    artifacts: forAllPlatforms((key) => ({
      kind: 'npm',
      packageName: `@anthropic-ai/claude-agent-sdk-${key}`,
      member: `package/claude${exe(key)}`,
      format: 'tgz',
    })),
  },
  'agent:codex': {
    id: 'agent:codex',
    binaryBase: 'codex',
    // codex has no JS SDK since the app-server rewrite; the installed `@openai/codex` meta
    // package (the CLI carrier agent-adapter depends on) is the pair version source.
    version: { kind: 'sdk-version', package: '@openai/codex' },
    // `@openai/codex-<platform>` package names are npm aliases that 404 on the registry; the
    // real versions live under `@openai/codex` with a platform-suffixed version key. The bare
    // binary spawns fine without its vendored rg/zsh siblings (drift smoke, 2026-07-08).
    artifacts: forAllPlatforms((key) => ({
      kind: 'npm',
      packageName: '@openai/codex',
      versionKey: (version: string) => `${version}-${key}`,
      member: `package/vendor/${CODEX_TRIPLES[key]}/bin/codex${exe(key)}`,
      format: 'tgz',
    })),
  },
  'agent:opencode': {
    id: 'agent:opencode',
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
  'tool:tectonic': {
    id: 'tool:tectonic',
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
  'tool:aigateway': {
    id: 'tool:aigateway',
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
};

export function descriptorFor(id: ManagedAssetId): AssetDescriptor {
  return CATALOG[id];
}
