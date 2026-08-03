/// <reference types="node" />
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { extractErrorMessage } from 'foxts/extract-error-message';
import type { ConfigBuildBundle } from '../config/build-bundle';
import { parseConfigBuildBundle } from '../config/build-bundle';
import type { ConfigChannel, ConfigPlatform } from '../config/types';

const execFileAsync = promisify(execFile);

const RE_GIT_SHA = /^[0-9a-f]{40}$/;
// Layout of the publisher checkout; the render CLI ships inside the publisher package itself.
const PUBLISHER_PACKAGE_PATH = 'packages/config-publisher';
const PUBLISHER_SCRIPT_PATH = 'packages/config-publisher/scripts/build-render.mts';

/** Explicit, fully pinned inputs for one build-bundle render. Nothing is defaulted or fetched:
 * both checkouts must already exist at the exact pinned commits or the render fails closed. */
export interface ConfigBuildRenderRequest {
  readonly brandId: string;
  readonly channel: ConfigChannel;
  readonly keyringsPath: string;
  readonly outPath: string;
  readonly platform: ConfigPlatform;
  /** Root of the config publisher checkout (contains the render CLI). */
  readonly publisherDir: string;
  /** Exact commit the publisher checkout must be at. */
  readonly publisherGitSha: string;
  readonly revisionPath: string;
  /** Exact commit the structural source checkout must be at. */
  readonly sourceGitSha: string;
  /** Structural configuration source directory (contains brands.manifest.yaml). */
  readonly structuralDir: string;
  readonly telemetryEndpoint: string;
}

export interface RenderCommandResult {
  readonly stdout: string;
}

export type RenderCommandRunner = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string },
) => Promise<RenderCommandResult>;

const defaultRunner: RenderCommandRunner = async (command, args, options) => {
  const { stdout } = await execFileAsync(command, [...args], {
    cwd: options.cwd,
    windowsHide: true,
  });
  return { stdout };
};

/** pnpm arguments that invoke the publisher's own build-render CLI inside its checkout. */
export function configBuildRenderArgs(request: ConfigBuildRenderRequest): readonly string[] {
  return [
    '--dir',
    join(request.publisherDir, PUBLISHER_PACKAGE_PATH),
    'run',
    'build-render',
    '--structural',
    request.structuralDir,
    '--source-git-sha',
    request.sourceGitSha,
    '--revision',
    request.revisionPath,
    '--keyrings',
    request.keyringsPath,
    '--brand',
    request.brandId,
    '--platform',
    request.platform,
    '--channel',
    request.channel,
    '--telemetry-endpoint',
    request.telemetryEndpoint,
    '--out',
    request.outPath,
  ];
}

/** Rejects rendered output that does not answer this exact request — stale or mismatched
 * generated bundles must stop the build instead of shipping. */
export function assertRenderedBundleMatches(
  bundle: ConfigBuildBundle,
  request: Pick<
    ConfigBuildRenderRequest,
    'brandId' | 'channel' | 'platform' | 'sourceGitSha' | 'telemetryEndpoint'
  >,
): void {
  const target = `${bundle.brandId}/${bundle.platform}/${bundle.channel}`;
  const expected = `${request.brandId}/${request.platform}/${request.channel}`;
  if (target !== expected) {
    throw new Error(`Rendered bundle targets ${target}, but this build requires ${expected}`);
  }
  if (bundle.provenance.sourceGitSha !== request.sourceGitSha) {
    throw new Error(
      `Rendered bundle was produced from source commit ${bundle.provenance.sourceGitSha}, ` +
        `but this build pins ${request.sourceGitSha}; regenerate from the pinned commit`,
    );
  }
  if (bundle.endpoints.telemetry !== request.telemetryEndpoint) {
    throw new Error(
      `Rendered bundle carries telemetry endpoint ${bundle.endpoints.telemetry}, ` +
        `but this build requires ${request.telemetryEndpoint}`,
    );
  }
}

async function assertPublisherCheckout(dir: string, pinnedSha: string): Promise<void> {
  try {
    const stats = await stat(join(dir, PUBLISHER_SCRIPT_PATH));
    if (!stats.isFile()) throw new Error('not a file');
  } catch {
    throw new Error(
      `Config publisher checkout not found at ${dir} (expected ${PUBLISHER_SCRIPT_PATH} inside). ` +
        `Check out the config publisher at commit ${pinnedSha} and pass its root explicitly; ` +
        'builds never fall back to a stale or global publisher install',
    );
  }
}

async function verifyPinnedCheckout(
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

/** Renders one build bundle by invoking the publisher CLI from a pinned checkout, then validates
 * the output with the frozen v1 contract. Rendering semantics live in the publisher only. */
export async function renderConfigBundleWithPublisher(
  request: ConfigBuildRenderRequest,
  run: RenderCommandRunner = defaultRunner,
): Promise<ConfigBuildBundle> {
  if (!RE_GIT_SHA.test(request.publisherGitSha)) {
    throw new Error('publisherGitSha must be an exact lowercase 40-hex commit');
  }
  if (!RE_GIT_SHA.test(request.sourceGitSha)) {
    throw new Error('sourceGitSha must be an exact lowercase 40-hex commit');
  }
  await assertPublisherCheckout(request.publisherDir, request.publisherGitSha);
  await verifyPinnedCheckout(
    request.publisherDir,
    request.publisherGitSha,
    'Config publisher',
    run,
  );
  await verifyPinnedCheckout(request.structuralDir, request.sourceGitSha, 'Config source', run);

  try {
    await run('pnpm', configBuildRenderArgs(request), { cwd: request.publisherDir });
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : '';
    throw new Error(
      `Config publisher render failed: ${extractErrorMessage(error)}${stderr ? `\n${stderr}` : ''}`,
      { cause: error },
    );
  }

  let text: string;
  try {
    text = await readFile(request.outPath, 'utf8');
  } catch {
    throw new Error(`Config publisher render did not produce ${request.outPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Rendered bundle at ${request.outPath} is not valid JSON`);
  }
  const bundle = parseConfigBuildBundle(parsed);
  assertRenderedBundleMatches(bundle, request);
  return bundle;
}
