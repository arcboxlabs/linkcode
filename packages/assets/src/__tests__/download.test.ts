import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ManagedAssetArtifact } from '@linkcode/schema';
import { afterEach, describe, expect, it } from 'vitest';
import type { DownloadProgress } from '../download';
import { downloadVerified } from '../download';
import { DownloadError, IntegrityError } from '../errors';
import type { LocalServer } from './helpers/local-server';
import { startLocalServer } from './helpers/local-server';

const payload = randomBytes(256 * 1024);
const sri = `sha512-${createHash('sha512').update(payload).digest('base64')}`;

const servers: LocalServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function source(handler: Parameters<typeof startLocalServer>[0]): Promise<string> {
  const server = await startLocalServer(handler);
  servers.push(server);
  return `${server.url}/artifact.tgz`;
}

function artifact(urls: string[], integrity = sri): ManagedAssetArtifact {
  return { urls, integrity, format: 'tgz', member: 'package/bin' };
}

function dest(): string {
  return join(mkdtempSync(join(tmpdir(), 'download-')), 'artifact.part');
}

describe('downloadVerified', () => {
  it('streams verified bytes to disk and reports progress up to the content length', async () => {
    const url = await source((_req, res) => {
      res.setHeader('content-length', String(payload.length));
      res.end(payload);
    });
    const file = dest();
    const progress: DownloadProgress[] = [];
    await downloadVerified(artifact([url]), file, (update) => progress.push(update));
    expect(readFileSync(file).equals(payload)).toBe(true);
    const last = progress.at(-1);
    expect(last).toEqual({ receivedBytes: payload.length, totalBytes: payload.length });
  });

  it('falls through failing sources until one delivers', async () => {
    const missing = await source((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    const truncating = await source((_req, res) => {
      res.setHeader('content-length', String(payload.length));
      res.write(payload.subarray(0, 1024));
      res.destroy();
    });
    const good = await source((_req, res) => {
      res.end(payload);
    });
    const file = dest();
    await downloadVerified(artifact([missing, truncating, good]), file);
    expect(readFileSync(file).equals(payload)).toBe(true);
  });

  it('rejects tampered bytes with IntegrityError and leaves no file behind', async () => {
    const tampered = await source((_req, res) => {
      res.end(Buffer.concat([payload.subarray(1), Buffer.from([0])]));
    });
    const file = dest();
    await expect(downloadVerified(artifact([tampered]), file)).rejects.toThrow(IntegrityError);
    expect(existsSync(file)).toBe(false);
  });

  it('reports a truncated single source as a DownloadError, not a stale partial file', async () => {
    const truncating = await source((_req, res) => {
      res.setHeader('content-length', String(payload.length));
      res.write(payload.subarray(0, 1024));
      res.destroy();
    });
    const file = dest();
    await expect(downloadVerified(artifact([truncating]), file)).rejects.toThrow(DownloadError);
    expect(existsSync(file)).toBe(false);
  });
});
