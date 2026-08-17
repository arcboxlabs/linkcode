import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { extractErrorMessage } from 'foxts/extract-error-message';

const CHANNELS = new Set(['canary', 'stable']);
const APPS = new Set(['desktop', 'mobile']);
const CONFIG_ORIGIN = 'config.linkcode.ai';
const MAX_DESCRIPTOR_BYTES = 1024 * 1024;
const MAX_INPUT_BYTES = 256 * 1024;
const PLATFORMS = new Set(['android', 'desktop', 'ios']);
const RE_BASE64 = /^(?:[a-z\d+/]{4})*(?:[a-z\d+/]{2}==|[a-z\d+/]{3}=)?$/i;
const RE_BRAND_ID = /^[a-z][a-z\d-]{0,62}$/;
const RE_RELEASE_INPUTS_PATH = /^\/release\/v1\/([a-z][a-z\d-]{0,62})\/(canary|stable)\.json$/;
const RE_SHA256 = /^[a-f\d]{64}$/;

export async function downloadConfigReleaseInputs({ app, fetchImpl = fetch, outDir, url }) {
  if (!APPS.has(app)) throw new TypeError('app is unsupported');
  if (!isAbsolute(outDir)) throw new TypeError('outDir must be absolute');
  const identity = releaseInputsUrl(url);
  const response = await fetchImpl(identity.url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`config release inputs returned HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new Error('config release inputs must use application/json');
  }
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > MAX_DESCRIPTOR_BYTES) {
    throw new Error('config release inputs exceed the response size limit');
  }
  const bytes = await boundedBody(response, MAX_DESCRIPTOR_BYTES);
  const files = parseConfigReleaseInputs(bytes, identity, app);
  await rm(outDir, { force: true, recursive: true });
  await mkdir(outDir, { mode: 0o700, recursive: true });
  for (const [name, content] of files) {
    // eslint-disable-next-line no-await-in-loop -- Complete each verified file before reporting success.
    await writeFile(join(outDir, name), content, { flag: 'wx', mode: 0o600 });
  }
  return { brandId: identity.brandId, channel: identity.channel };
}

export function parseConfigReleaseInputs(bytes, identity, app) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_DESCRIPTOR_BYTES) {
    throw new TypeError('config release inputs exceed the response size limit');
  }
  let descriptor;
  try {
    descriptor = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new TypeError('config release inputs must be valid UTF-8 JSON');
  }
  record(descriptor, 'release inputs');
  exactKeys(
    descriptor,
    ['brandId', 'channel', 'files', 'releaseInputsFormatVersion'],
    'release inputs',
  );
  if (descriptor.releaseInputsFormatVersion !== 1) {
    throw new TypeError('releaseInputsFormatVersion is unsupported');
  }
  if (descriptor.brandId !== identity.brandId || descriptor.channel !== identity.channel) {
    throw new TypeError('config release inputs do not match their URL target');
  }
  record(descriptor.files, 'release inputs files');
  exactKeys(descriptor.files, ['keyrings', 'manifests', 'revision'], 'release inputs files');
  record(descriptor.files.manifests, 'release input manifests');
  exactKeys(descriptor.files.manifests, [...PLATFORMS], 'release input manifests');
  const manifestPlatforms = Object.keys(descriptor.files.manifests);
  const requiredPlatforms = app === 'desktop' ? ['desktop'] : ['ios', 'android'];

  const revision = encodedFile(descriptor.files.revision, 'revision');
  const keyrings = encodedFile(descriptor.files.keyrings, 'keyrings');
  jsonObject(revision, 'revision');
  jsonObject(keyrings, 'keyrings');
  const manifests = new Map(
    manifestPlatforms.map((platform) => [
      platform,
      encodedFile(descriptor.files.manifests[platform], `${platform} manifest`),
    ]),
  );
  let common;
  for (const [platform, manifestBytes] of manifests) {
    const manifest = jsonObject(manifestBytes, `${platform} manifest`);
    if (
      manifest.releaseManifestFormatVersion !== 2 ||
      manifest.brandId !== identity.brandId ||
      manifest.channel !== identity.channel ||
      manifest.platform !== platform ||
      manifest.revisionSha256 !== sha256(revision) ||
      manifest.publicKeyringsSha256 !== sha256(keyrings)
    ) {
      throw new TypeError(`${platform} release manifest does not bind the downloaded inputs`);
    }
    const binding = JSON.stringify([
      manifest.publisherGitSha,
      manifest.sourceGitSha,
      manifest.configRevisionId,
      manifest.revisionSha256,
      manifest.publicKeyringsSha256,
      manifest.telemetryEndpoint,
    ]);
    if (common !== undefined && common !== binding) {
      throw new TypeError('release manifests do not share one immutable input set');
    }
    common = binding;
  }
  const output = new Map([
    ['revision.json', revision],
    ['keyrings.json', keyrings],
  ]);
  for (const platform of requiredPlatforms) {
    output.set(`manifest-${platform}.json`, manifests.get(platform));
  }
  return output;
}

export function releaseInputsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError('release inputs URL is invalid');
  }
  const match = RE_RELEASE_INPUTS_PATH.exec(url.pathname);
  if (
    !match ||
    url.protocol !== 'https:' ||
    url.hostname !== CONFIG_ORIGIN ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.href !== value ||
    !RE_BRAND_ID.test(match[1]) ||
    !CHANNELS.has(match[2])
  ) {
    throw new TypeError('release inputs URL must be one canonical HTTPS brand/channel endpoint');
  }
  return { brandId: match[1], channel: match[2], url: url.href };
}

async function boundedBody(response, limit) {
  if (!response.body) throw new Error('config release inputs response has no body');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    // eslint-disable-next-line no-await-in-loop -- Enforce the byte limit while streaming.
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      // eslint-disable-next-line no-await-in-loop -- Stop the bounded stream before rejecting it.
      await reader.cancel();
      throw new Error('config release inputs exceed the response size limit');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function encodedFile(value, label) {
  record(value, label);
  exactKeys(value, ['contentBase64', 'sha256'], label);
  if (
    typeof value.contentBase64 !== 'string' ||
    value.contentBase64.length === 0 ||
    !RE_BASE64.test(value.contentBase64) ||
    typeof value.sha256 !== 'string' ||
    !RE_SHA256.test(value.sha256)
  ) {
    throw new TypeError(`${label} encoding is invalid`);
  }
  const bytes = Buffer.from(value.contentBase64, 'base64');
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_INPUT_BYTES ||
    bytes.toString('base64') !== value.contentBase64 ||
    sha256(bytes) !== value.sha256
  ) {
    throw new TypeError(`${label} bytes do not match their digest`);
  }
  return bytes;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).toSorted();
  const sortedExpected = expected.toSorted();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError(`${label} contains missing or unsupported fields`);
  }
}

function jsonObject(bytes, label) {
  let value;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (`${text.trimEnd()}\n` !== text) throw new TypeError('noncanonical JSON ending');
    value = JSON.parse(text);
  } catch {
    throw new TypeError(`${label} must be valid UTF-8 JSON ending in one newline`);
  }
  return record(value, label);
}

function record(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const { values } = parseArgs({
    options: {
      app: { type: 'string' },
      out: { type: 'string' },
      url: { type: 'string' },
    },
    strict: true,
  });
  if (!values.app || !values.out || !values.url) {
    throw new TypeError('--app, --out, and --url are required');
  }
  const result = await downloadConfigReleaseInputs({
    app: values.app,
    outDir: values.out,
    url: values.url,
  });
  console.log(`Downloaded config release inputs for ${result.brandId}/${result.channel}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(extractErrorMessage(error));
    process.exitCode = 1;
  });
}
