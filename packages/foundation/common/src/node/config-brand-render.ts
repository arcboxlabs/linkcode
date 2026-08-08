/// <reference types="node" />
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractErrorMessage } from 'foxts/extract-error-message';
import type { BrandIdentityArtifact } from '../config/brand-identity';
import { parseBrandIdentityArtifact } from '../config/brand-identity';
import type { ConfigChannel, ConfigPlatform } from '../config/types';
import type { RenderCommandRunner } from './render-checkout';
import {
  assertPublisherCheckout,
  defaultRenderCommandRunner,
  RE_GIT_SHA,
  verifyPinnedCheckout,
} from './render-checkout';

// Layout of the publisher checkout; the render CLI ships inside the publisher package itself.
const PUBLISHER_PACKAGE_PATH = 'packages/config-publisher';
const PUBLISHER_SCRIPT_PATH = 'packages/config-publisher/scripts/brand-render.mts';

/** Explicit, fully pinned inputs for one brand identity render. Nothing is defaulted or fetched:
 * both checkouts must already exist at the exact pinned commits or the render fails closed. */
export interface ConfigBrandRenderRequest {
  readonly brandId: string;
  readonly channel: ConfigChannel;
  readonly outPath: string;
  readonly platform: ConfigPlatform;
  /** Root of the config publisher checkout (contains the render CLI). */
  readonly publisherDir: string;
  /** Exact commit the publisher checkout must be at. */
  readonly publisherGitSha: string;
  /** Exact commit the structural source checkout must be at. */
  readonly sourceGitSha: string;
  /** Structural configuration source directory (contains brands.manifest.yaml). */
  readonly structuralDir: string;
}

/** pnpm arguments that invoke the publisher's own brand-render CLI inside its checkout. */
export function configBrandRenderArgs(request: ConfigBrandRenderRequest): readonly string[] {
  return [
    '--dir',
    join(request.publisherDir, PUBLISHER_PACKAGE_PATH),
    'run',
    'brand-render',
    '--structural',
    request.structuralDir,
    '--source-git-sha',
    request.sourceGitSha,
    '--brand',
    request.brandId,
    '--platform',
    request.platform,
    '--channel',
    request.channel,
    '--out',
    request.outPath,
  ];
}

/** Rejects rendered identity that does not answer this exact request — stale or mismatched
 * generated artifacts must stop the build instead of shipping another brand's identity. */
export function assertRenderedIdentityMatches(
  identity: BrandIdentityArtifact,
  request: Pick<ConfigBrandRenderRequest, 'brandId' | 'channel' | 'platform' | 'sourceGitSha'>,
): void {
  const target = `${identity.brandId}/${identity.platform}/${identity.channel}`;
  const expected = `${request.brandId}/${request.platform}/${request.channel}`;
  if (target !== expected) {
    throw new Error(`Rendered identity targets ${target}, but this build requires ${expected}`);
  }
  if (identity.provenance.sourceGitSha !== request.sourceGitSha) {
    throw new Error(
      `Rendered identity was produced from source commit ${identity.provenance.sourceGitSha}, ` +
        `but this build pins ${request.sourceGitSha}; regenerate from the pinned commit`,
    );
  }
}

/** Renders one brand identity by invoking the publisher CLI from a pinned checkout, then
 * validates the output with the frozen v1 contract. Derivation lives in the publisher only. */
export async function renderBrandIdentityWithPublisher(
  request: ConfigBrandRenderRequest,
  run: RenderCommandRunner = defaultRenderCommandRunner,
): Promise<BrandIdentityArtifact> {
  if (!RE_GIT_SHA.test(request.publisherGitSha)) {
    throw new Error('publisherGitSha must be an exact lowercase 40-hex commit');
  }
  if (!RE_GIT_SHA.test(request.sourceGitSha)) {
    throw new Error('sourceGitSha must be an exact lowercase 40-hex commit');
  }
  await assertPublisherCheckout(
    request.publisherDir,
    request.publisherGitSha,
    PUBLISHER_SCRIPT_PATH,
  );
  await verifyPinnedCheckout(
    request.publisherDir,
    request.publisherGitSha,
    'Config publisher',
    run,
  );
  await verifyPinnedCheckout(request.structuralDir, request.sourceGitSha, 'Config source', run);

  try {
    await run('pnpm', configBrandRenderArgs(request), { cwd: request.publisherDir });
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error ? String(error.stderr) : '';
    throw new Error(
      `Config publisher brand render failed: ${extractErrorMessage(error)}${stderr ? `\n${stderr}` : ''}`,
      { cause: error },
    );
  }

  let text: string;
  try {
    text = await readFile(request.outPath, 'utf8');
  } catch {
    throw new Error(`Config publisher brand render did not produce ${request.outPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Rendered identity at ${request.outPath} is not valid JSON`);
  }
  const identity = parseBrandIdentityArtifact(parsed);
  assertRenderedIdentityMatches(identity, request);
  return identity;
}
