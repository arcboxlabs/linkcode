import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixture from '../../config/__fixtures__/build-bundle-v1.json';
import { parseConfigBuildBundle } from '../../config/build-bundle';
import type { ConfigBuildRenderRequest, RenderCommandRunner } from '../config-build-render';
import {
  assertRenderedBundleMatches,
  configBuildRenderArgs,
  renderConfigBundleWithPublisher,
} from '../config-build-render';

const PUBLISHER_SHA = 'a'.repeat(40);
const fixtureBundle = parseConfigBuildBundle(structuredClone(fixture));
const SOURCE_SHA = fixtureBundle.provenance.sourceGitSha;

const RE_CHECKOUT_ABSENT = /Config publisher checkout not found/;
const RE_WRONG_COMMIT = /is at commit b{40}, but this build pins a{40}/;
const RE_DIRTY_CHECKOUT = /has local modifications/;
const RE_NO_OUTPUT = /did not produce/;
const RE_TAMPERED = /sha256 does not match/;
const RE_TARGET_MISMATCH =
  /targets acme\/desktop\/stable, but this build requires other-brand\/desktop\/stable/;
const RE_SOURCE_DRIFT = /regenerate from the pinned commit/;
const RE_TELEMETRY_MISMATCH = /telemetry endpoint/;
const RE_BINDING_SNAPSHOT = /Release manifest binding failed: expectedSnapshotSha256/;
const RE_BINDING_REVISION = /Release manifest binding failed: revisionSha256/;
const RE_UNSUPPORTED_FIELD = /unsupported field extra/;

function headForDir(dir: string): string {
  return dir.endsWith('structural') ? SOURCE_SHA : PUBLISHER_SHA;
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'config-build-render-'));
});

afterEach(async () => {
  await rm(workDir, { force: true, recursive: true });
});

interface RecordedCall {
  readonly args: readonly string[];
  readonly command: string;
  readonly cwd: string;
}

function fakeRunner(options: {
  head?: (dir: string) => string;
  onRender?: () => Promise<void>;
  status?: string;
}): { calls: RecordedCall[]; run: RenderCommandRunner } {
  const calls: RecordedCall[] = [];
  const run: RenderCommandRunner = async (command, args, { cwd }) => {
    calls.push({ args, command, cwd });
    if (command === 'git' && args[2] === 'rev-parse') {
      const dir = args[1];
      return { stdout: `${options.head?.(dir) ?? headForDir(dir)}\n` };
    }
    if (command === 'git' && args[2] === 'status') {
      return { stdout: options.status ?? '' };
    }
    if (command === 'pnpm') {
      await options.onRender?.();
      return { stdout: '' };
    }
    throw new Error(`unexpected command ${command}`);
  };
  return { calls, run };
}

async function makePublisherCheckout(): Promise<string> {
  const publisherDir = join(workDir, 'publisher');
  await mkdir(join(publisherDir, 'packages/config-publisher/scripts'), { recursive: true });
  await writeFile(join(publisherDir, 'packages/config-publisher/scripts/build-render.mts'), '');
  return publisherDir;
}

function makeRequest(publisherDir: string): ConfigBuildRenderRequest {
  return {
    brandId: fixtureBundle.brandId,
    channel: fixtureBundle.channel,
    keyringsPath: join(workDir, 'keyrings.json'),
    outPath: join(workDir, 'bundle.json'),
    platform: fixtureBundle.platform,
    publisherDir,
    publisherGitSha: PUBLISHER_SHA,
    revisionPath: join(workDir, 'revision.json'),
    sourceGitSha: SOURCE_SHA,
    structuralDir: join(workDir, 'structural'),
    telemetryEndpoint: fixtureBundle.endpoints.telemetry,
  };
}

describe('renderConfigBundleWithPublisher', () => {
  it('renders through the pinned publisher CLI and validates the output', async () => {
    const publisherDir = await makePublisherCheckout();
    const request = makeRequest(publisherDir);
    const { calls, run } = fakeRunner({
      onRender: () => writeFile(request.outPath, JSON.stringify(fixture)),
    });

    const bundle = await renderConfigBundleWithPublisher(request, run);
    expect(bundle.brandId).toBe('acme');
    expect(bundle.provenance.sourceGitSha).toBe(SOURCE_SHA);

    const render = calls.find((call) => call.command === 'pnpm');
    expect(render).toBeDefined();
    expect(render?.cwd).toBe(publisherDir);
    expect(render?.args).toEqual(configBuildRenderArgs(request));
    expect(render?.args).toContain('--telemetry-endpoint');
    // Both checkouts were pin-verified and checked for local modifications before rendering.
    const gitCalls = calls.filter((call) => call.command === 'git');
    expect(gitCalls).toHaveLength(4);
  });

  it('fails with an actionable error when the publisher checkout is absent', async () => {
    const request = makeRequest(join(workDir, 'missing'));
    const { calls, run } = fakeRunner({});
    await expect(renderConfigBundleWithPublisher(request, run)).rejects.toThrow(RE_CHECKOUT_ABSENT);
    expect(calls).toHaveLength(0);
  });

  it('rejects malformed commit pins before touching any checkout', async () => {
    const publisherDir = await makePublisherCheckout();
    const { calls, run } = fakeRunner({});
    await expect(
      renderConfigBundleWithPublisher(
        { ...makeRequest(publisherDir), publisherGitSha: 'HEAD' },
        run,
      ),
    ).rejects.toThrow('publisherGitSha must be an exact lowercase 40-hex commit');
    await expect(
      renderConfigBundleWithPublisher(
        { ...makeRequest(publisherDir), sourceGitSha: SOURCE_SHA.toUpperCase() },
        run,
      ),
    ).rejects.toThrow('sourceGitSha must be an exact lowercase 40-hex commit');
    expect(calls).toHaveLength(0);
  });

  it('refuses a publisher checkout at the wrong commit', async () => {
    const publisherDir = await makePublisherCheckout();
    const { run } = fakeRunner({ head: () => 'b'.repeat(40) });
    await expect(renderConfigBundleWithPublisher(makeRequest(publisherDir), run)).rejects.toThrow(
      RE_WRONG_COMMIT,
    );
  });

  it('refuses a checkout with local modifications', async () => {
    const publisherDir = await makePublisherCheckout();
    const { run } = fakeRunner({ status: ' M packages/config-publisher/src/render.ts\n' });
    await expect(renderConfigBundleWithPublisher(makeRequest(publisherDir), run)).rejects.toThrow(
      RE_DIRTY_CHECKOUT,
    );
  });

  it('fails when the publisher CLI does not produce the output file', async () => {
    const publisherDir = await makePublisherCheckout();
    const { run } = fakeRunner({});
    await expect(renderConfigBundleWithPublisher(makeRequest(publisherDir), run)).rejects.toThrow(
      RE_NO_OUTPUT,
    );
  });

  it('removes stale output before invoking the publisher', async () => {
    const publisherDir = await makePublisherCheckout();
    const request = makeRequest(publisherDir);
    await writeFile(request.outPath, JSON.stringify(fixture));
    const { run } = fakeRunner({});

    await expect(renderConfigBundleWithPublisher(request, run)).rejects.toThrow(RE_NO_OUTPUT);
    await expect(readFile(request.outPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed when the rendered output is tampered', async () => {
    const publisherDir = await makePublisherCheckout();
    const request = makeRequest(publisherDir);
    const tampered = structuredClone(fixture) as { snapshot: { sha256: string } };
    tampered.snapshot.sha256 = '0'.repeat(64);
    const { run } = fakeRunner({
      onRender: () => writeFile(request.outPath, JSON.stringify(tampered)),
    });
    await expect(renderConfigBundleWithPublisher(request, run)).rejects.toThrow(RE_TAMPERED);
  });

  it('rejects rendered output answering a different request', async () => {
    const publisherDir = await makePublisherCheckout();
    const request = { ...makeRequest(publisherDir), brandId: 'other-brand' };
    const { run } = fakeRunner({
      onRender: () => writeFile(request.outPath, JSON.stringify(fixture)),
    });
    await expect(renderConfigBundleWithPublisher(request, run)).rejects.toThrow(RE_TARGET_MISMATCH);
  });
});

describe('release manifest binding', () => {
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  const REVISION_TEXT = '{"configRevisionId":"rev-fixture"}';
  const KEYRINGS_TEXT = '{"normal":{},"emergency":{}}';

  async function makeBoundRequest(): Promise<ConfigBuildRenderRequest> {
    const publisherDir = await makePublisherCheckout();
    const request: ConfigBuildRenderRequest = {
      ...makeRequest(publisherDir),
      releaseManifestPath: join(workDir, 'release-manifest.json'),
    };
    await writeFile(request.revisionPath, REVISION_TEXT);
    await writeFile(request.keyringsPath, KEYRINGS_TEXT);
    await writeFile(
      request.releaseManifestPath!,
      JSON.stringify({
        brandId: fixtureBundle.brandId,
        channel: fixtureBundle.channel,
        configRevisionId: fixtureBundle.provenance.configRevisionId,
        expectedSnapshotSha256: fixtureBundle.snapshot.sha256,
        platform: fixtureBundle.platform,
        publicKeyringsSha256: digest(KEYRINGS_TEXT),
        publisherGitSha: PUBLISHER_SHA,
        releaseManifestFormatVersion: 1,
        revisionSha256: digest(REVISION_TEXT),
        sourceGitSha: SOURCE_SHA,
        telemetryEndpoint: fixtureBundle.endpoints.telemetry,
      }),
    );
    return request;
  }

  it('passes the manifest through to the publisher CLI and verifies the binding', async () => {
    const request = await makeBoundRequest();
    const { calls, run } = fakeRunner({
      onRender: () => writeFile(request.outPath, JSON.stringify(fixture)),
    });
    const bundle = await renderConfigBundleWithPublisher(request, run);
    expect(bundle.snapshot.sha256).toBe(fixtureBundle.snapshot.sha256);
    const render = calls.find((call) => call.command === 'pnpm');
    expect(render?.args).toContain('--release-manifest');
    expect(render?.args).toContain(request.releaseManifestPath);
  });

  it('fails when the rendered snapshot digest is not the pinned published digest', async () => {
    const request = await makeBoundRequest();
    const manifest = JSON.parse(await readFile(request.releaseManifestPath!, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(
      request.releaseManifestPath!,
      JSON.stringify({ ...manifest, expectedSnapshotSha256: 'f'.repeat(64) }),
    );
    const { run } = fakeRunner({
      onRender: () => writeFile(request.outPath, JSON.stringify(fixture)),
    });
    await expect(renderConfigBundleWithPublisher(request, run)).rejects.toThrow(
      RE_BINDING_SNAPSHOT,
    );
  });

  it('fails when input file bytes differ from their pinned digests', async () => {
    const request = await makeBoundRequest();
    await writeFile(request.revisionPath, `${REVISION_TEXT}\n`);
    const { run } = fakeRunner({
      onRender: () => writeFile(request.outPath, JSON.stringify(fixture)),
    });
    await expect(renderConfigBundleWithPublisher(request, run)).rejects.toThrow(
      RE_BINDING_REVISION,
    );
  });

  it('fails closed on unknown manifest fields', async () => {
    const request = await makeBoundRequest();
    const manifest = JSON.parse(await readFile(request.releaseManifestPath!, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(request.releaseManifestPath!, JSON.stringify({ ...manifest, extra: true }));
    const { run } = fakeRunner({
      onRender: () => writeFile(request.outPath, JSON.stringify(fixture)),
    });
    await expect(renderConfigBundleWithPublisher(request, run)).rejects.toThrow(
      RE_UNSUPPORTED_FIELD,
    );
  });
});

describe('assertRenderedBundleMatches', () => {
  const matching = {
    brandId: fixtureBundle.brandId,
    channel: fixtureBundle.channel,
    platform: fixtureBundle.platform,
    sourceGitSha: SOURCE_SHA,
    telemetryEndpoint: fixtureBundle.endpoints.telemetry,
  } as const;

  it('accepts a bundle that answers the request exactly', () => {
    expect(() => assertRenderedBundleMatches(fixtureBundle, matching)).not.toThrow();
  });

  it('rejects source commit drift', () => {
    expect(() =>
      assertRenderedBundleMatches(fixtureBundle, { ...matching, sourceGitSha: 'c'.repeat(40) }),
    ).toThrow(RE_SOURCE_DRIFT);
  });

  it('rejects a telemetry endpoint mismatch', () => {
    expect(() =>
      assertRenderedBundleMatches(fixtureBundle, {
        ...matching,
        telemetryEndpoint: 'https://telemetry.example.invalid/else',
      }),
    ).toThrow(RE_TELEMETRY_MISMATCH);
  });
});
