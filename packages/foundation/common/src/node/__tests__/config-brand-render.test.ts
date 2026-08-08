import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixture from '../../config/__fixtures__/brand-identity-v1.json';
import { parseBrandIdentityArtifact } from '../../config/brand-identity';
import type { ConfigBrandRenderRequest } from '../config-brand-render';
import {
  assertRenderedIdentityMatches,
  configBrandRenderArgs,
  renderBrandIdentityWithPublisher,
} from '../config-brand-render';
import type { RenderCommandRunner } from '../render-checkout';

const PUBLISHER_SHA = 'a'.repeat(40);
const fixtureIdentity = parseBrandIdentityArtifact(structuredClone(fixture));
const SOURCE_SHA = fixtureIdentity.provenance.sourceGitSha;

const RE_CHECKOUT_ABSENT = /Config publisher checkout not found/;
const RE_WRONG_COMMIT = /is at commit b{40}, but this build pins a{40}/;
const RE_DIRTY_CHECKOUT = /has local modifications/;
const RE_NO_OUTPUT = /did not produce/;
const RE_TARGET_MISMATCH =
  /targets acme\/desktop\/stable, but this build requires other-brand\/desktop\/stable/;
const RE_SOURCE_DRIFT = /regenerate from the pinned commit/;
const RE_FIXTURE_TARGET = /targets acme\/desktop\/stable/;

function headForDir(dir: string): string {
  return dir.endsWith('structural') ? SOURCE_SHA : PUBLISHER_SHA;
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'config-brand-render-'));
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
  await writeFile(join(publisherDir, 'packages/config-publisher/scripts/brand-render.mts'), '');
  return publisherDir;
}

function makeRequest(publisherDir: string): ConfigBrandRenderRequest {
  return {
    brandId: fixtureIdentity.brandId,
    channel: fixtureIdentity.channel,
    outPath: join(workDir, 'identity.json'),
    platform: fixtureIdentity.platform,
    publisherDir,
    publisherGitSha: PUBLISHER_SHA,
    sourceGitSha: SOURCE_SHA,
    structuralDir: join(workDir, 'structural'),
  };
}

describe('renderBrandIdentityWithPublisher', () => {
  it('renders through the pinned publisher CLI and validates the output', async () => {
    const publisherDir = await makePublisherCheckout();
    const request = makeRequest(publisherDir);
    const { calls, run } = fakeRunner({
      onRender: () => writeFile(request.outPath, JSON.stringify(fixture)),
    });

    const identity = await renderBrandIdentityWithPublisher(request, run);
    expect(identity.brandId).toBe('acme');
    expect(identity.applicationId).toBe('dev.arcbox.acme.desktop');
    expect(identity.provenance.sourceGitSha).toBe(SOURCE_SHA);

    const render = calls.find((call) => call.command === 'pnpm');
    expect(render).toBeDefined();
    expect(render?.cwd).toBe(publisherDir);
    expect(render?.args).toEqual(configBrandRenderArgs(request));
    // Both checkouts were pin-verified and checked for local modifications before rendering.
    const gitCalls = calls.filter((call) => call.command === 'git');
    expect(gitCalls).toHaveLength(4);
  });

  it('fails with an actionable error when the publisher checkout is absent', async () => {
    const request = makeRequest(join(workDir, 'missing'));
    const { calls, run } = fakeRunner({});
    await expect(renderBrandIdentityWithPublisher(request, run)).rejects.toThrow(
      RE_CHECKOUT_ABSENT,
    );
    expect(calls).toHaveLength(0);
  });

  it('rejects malformed commit pins before touching any checkout', async () => {
    const publisherDir = await makePublisherCheckout();
    const { calls, run } = fakeRunner({});
    await expect(
      renderBrandIdentityWithPublisher(
        { ...makeRequest(publisherDir), publisherGitSha: 'HEAD' },
        run,
      ),
    ).rejects.toThrow('publisherGitSha must be an exact lowercase 40-hex commit');
    await expect(
      renderBrandIdentityWithPublisher(
        { ...makeRequest(publisherDir), sourceGitSha: SOURCE_SHA.toUpperCase() },
        run,
      ),
    ).rejects.toThrow('sourceGitSha must be an exact lowercase 40-hex commit');
    expect(calls).toHaveLength(0);
  });

  it('refuses a publisher checkout at the wrong commit', async () => {
    const publisherDir = await makePublisherCheckout();
    const { run } = fakeRunner({ head: () => 'b'.repeat(40) });
    await expect(renderBrandIdentityWithPublisher(makeRequest(publisherDir), run)).rejects.toThrow(
      RE_WRONG_COMMIT,
    );
  });

  it('refuses a checkout with local modifications', async () => {
    const publisherDir = await makePublisherCheckout();
    const { run } = fakeRunner({ status: ' M packages/config-publisher/src/render.ts\n' });
    await expect(renderBrandIdentityWithPublisher(makeRequest(publisherDir), run)).rejects.toThrow(
      RE_DIRTY_CHECKOUT,
    );
  });

  it('fails when the publisher CLI does not produce the output file', async () => {
    const publisherDir = await makePublisherCheckout();
    const { run } = fakeRunner({});
    await expect(renderBrandIdentityWithPublisher(makeRequest(publisherDir), run)).rejects.toThrow(
      RE_NO_OUTPUT,
    );
  });

  it('fails closed when the rendered output is malformed', async () => {
    const publisherDir = await makePublisherCheckout();
    const request = makeRequest(publisherDir);
    const tampered = structuredClone(fixture) as { urlScheme: string };
    tampered.urlScheme = 'Not A Scheme';
    const { run } = fakeRunner({
      onRender: () => writeFile(request.outPath, JSON.stringify(tampered)),
    });
    await expect(renderBrandIdentityWithPublisher(request, run)).rejects.toThrow(
      'artifact.urlScheme is invalid',
    );
  });

  it('rejects rendered output answering a different request', async () => {
    const publisherDir = await makePublisherCheckout();
    const request = { ...makeRequest(publisherDir), brandId: 'other-brand' };
    const { run } = fakeRunner({
      onRender: () => writeFile(request.outPath, JSON.stringify(fixture)),
    });
    await expect(renderBrandIdentityWithPublisher(request, run)).rejects.toThrow(
      RE_TARGET_MISMATCH,
    );
  });
});

describe('assertRenderedIdentityMatches', () => {
  const matching = {
    brandId: fixtureIdentity.brandId,
    channel: fixtureIdentity.channel,
    platform: fixtureIdentity.platform,
    sourceGitSha: SOURCE_SHA,
  } as const;

  it('accepts an identity that answers the request exactly', () => {
    expect(() => assertRenderedIdentityMatches(fixtureIdentity, matching)).not.toThrow();
  });

  it('rejects source commit drift', () => {
    expect(() =>
      assertRenderedIdentityMatches(fixtureIdentity, { ...matching, sourceGitSha: 'c'.repeat(40) }),
    ).toThrow(RE_SOURCE_DRIFT);
  });

  it('rejects a channel mismatch', () => {
    expect(() =>
      assertRenderedIdentityMatches(fixtureIdentity, { ...matching, channel: 'canary' }),
    ).toThrow(RE_FIXTURE_TARGET);
  });
});
