import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadConfigReleaseInputs,
  parseConfigReleaseInputs,
  releaseInputsUrl,
} from './config-release-inputs.mjs';

const directories = [];
const RE_COPIED_RELEASE_INPUT = /vars\.CONFIG_RELEASE_(?:REVISION|KEYRINGS|MANIFEST_)/;
const url = 'https://config.linkcode.ai/release/v1/linkcode/stable.json';
const revision = {
  configRevisionId: 'revision-1',
  configVersion: '1',
  generatedAt: '2026-08-16T00:00:00Z',
  operational: [],
  overrides: [],
  revisionFormatVersion: 1,
  rollouts: {},
};
const keyrings = { emergency: {}, normal: { 'normal-1': 'public-key' } };

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('config release inputs', () => {
  it('decodes exact digest-bound bytes for the selected app', () => {
    const fixture = descriptor();
    const files = parseConfigReleaseInputs(
      Buffer.from(`${JSON.stringify(fixture)}\n`),
      releaseInputsUrl(url),
      'mobile',
    );
    expect([...files.keys()]).toEqual([
      'revision.json',
      'keyrings.json',
      'manifest-ios.json',
      'manifest-android.json',
    ]);
    expect(files.get('revision.json')).toEqual(inputBytes(revision));
    expect(JSON.parse(files.get('manifest-ios.json').toString())).toMatchObject({
      brandId: 'linkcode',
      channel: 'stable',
      platform: 'ios',
      releaseManifestFormatVersion: 2,
    });
  });

  it('rejects noncanonical URLs, unknown fields, digest drift, and mixed targets', () => {
    for (const invalid of [
      'http://config.linkcode.ai/release/v1/linkcode/stable.json',
      'https://example.com/release/v1/linkcode/stable.json',
      'https://config.linkcode.ai/release/v1/linkcode/stable.json?revision=1',
      'https://config.linkcode.ai/release/v1/linkcode/stable.json/',
    ]) {
      expect(() => releaseInputsUrl(invalid)).toThrow('canonical HTTPS');
    }
    const extra = descriptor();
    extra.hidden = true;
    expect(() => parse(extra, 'desktop')).toThrow('missing or unsupported fields');

    const drifted = descriptor();
    drifted.files.revision.sha256 = 'f'.repeat(64);
    expect(() => parse(drifted, 'desktop')).toThrow('do not match their digest');

    const incomplete = descriptor();
    delete incomplete.files.manifests.android;
    expect(() => parse(incomplete, 'desktop')).toThrow('missing or unsupported fields');

    const missingNewline = descriptor();
    missingNewline.files.keyrings = encoded(keyrings, false);
    expect(() => parse(missingNewline, 'desktop')).toThrow('ending in one newline');

    const mixed = descriptor();
    const ios = JSON.parse(
      Buffer.from(mixed.files.manifests.ios.contentBase64, 'base64').toString(),
    );
    ios.sourceGitSha = 'f'.repeat(40);
    mixed.files.manifests.ios = encoded(ios);
    expect(() => parse(mixed, 'mobile')).toThrow('do not share one immutable input set');
  });

  it('downloads once without redirects and writes only verified files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'linkcode-release-inputs-'));
    directories.push(directory);
    const body = `${JSON.stringify(descriptor())}\n`;
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(body, {
          headers: { 'content-type': 'application/json; charset=utf-8' },
          status: 200,
        }),
      ),
    );
    await downloadConfigReleaseInputs({ app: 'desktop', fetchImpl, outDir: directory, url });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'error' }));
    expect(await readFile(join(directory, 'revision.json'))).toEqual(inputBytes(revision));
    expect(await readFile(join(directory, 'manifest-desktop.json'))).toEqual(
      inputBytes(manifest('desktop')),
    );
  });

  it('keeps official Desktop and Mobile builds off copied JSON variables', async () => {
    const workflows = await Promise.all(
      ['build-desktop.yml', 'build-mobile.yml'].map((name) =>
        readFile(new URL(`../workflows/${name}`, import.meta.url), 'utf8'),
      ),
    );
    for (const workflow of workflows) {
      expect(workflow).toContain(
        'release-inputs-url: https://config.linkcode.ai/release/v1/linkcode/stable.json',
      );
      expect(workflow).not.toMatch(RE_COPIED_RELEASE_INPUT);
    }
  });
});

function descriptor() {
  return {
    brandId: 'linkcode',
    channel: 'stable',
    files: {
      keyrings: encoded(keyrings),
      manifests: {
        android: encoded(manifest('android')),
        desktop: encoded(manifest('desktop')),
        ios: encoded(manifest('ios')),
      },
      revision: encoded(revision),
    },
    releaseInputsFormatVersion: 1,
  };
}

function manifest(platform) {
  return {
    brandId: 'linkcode',
    channel: 'stable',
    configRevisionId: 'revision-1',
    expectedSnapshotSha256: 'a'.repeat(64),
    platform,
    publicKeyringsSha256: sha256(inputBytes(keyrings)),
    publisherGitSha: 'b'.repeat(40),
    releaseManifestFormatVersion: 2,
    revisionSha256: sha256(inputBytes(revision)),
    sourceGitSha: 'c'.repeat(40),
    telemetryEndpoint: 'https://api.linkcode.ai/config-events',
  };
}

function encoded(value, newline = true) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}${newline ? '\n' : ''}`);
  return { contentBase64: bytes.toString('base64'), sha256: sha256(bytes) };
}

function inputBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function parse(value, app) {
  return parseConfigReleaseInputs(Buffer.from(JSON.stringify(value)), releaseInputsUrl(url), app);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
