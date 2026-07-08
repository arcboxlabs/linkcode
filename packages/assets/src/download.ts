/// <reference types="node" />
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { ManagedAssetArtifact } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { DownloadError, IntegrityError } from './errors';
import type { SriDigest } from './sri';
import { strongestSriDigest } from './sri';

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes?: number;
}

/** Whole-body ceiling; the largest artifact (codex, ~94 MB) fits comfortably on slow links. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60000;

/**
 * Download an artifact to `destFile`, walking the ordered source list until one delivers
 * SRI-verified bytes. The body streams straight to disk through an incremental hash — no
 * buffering, and a truncated or tampered transfer can never leave a "valid" file: the
 * destination is deleted on any failure. An integrity mismatch just fails that source
 * (hash-pinning makes sources interchangeable), but is reported as `IntegrityError` when no
 * source survives. ENOSPC aborts the walk — the next source cannot help a full disk.
 */
export async function downloadVerified(
  artifact: ManagedAssetArtifact,
  destFile: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  const digest = strongestSriDigest(artifact.integrity);
  const failures: string[] = [];
  let integrityFailed = false;
  for (const url of artifact.urls) {
    try {
      // eslint-disable-next-line no-await-in-loop -- urls are an ordered fallback list
      await downloadFrom(url, destFile, digest, artifact.size, onProgress);
      return;
    } catch (error) {
      // eslint-disable-next-line no-await-in-loop -- cleanup before trying the next source
      await rm(destFile, { force: true });
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw new DownloadError(`disk full while downloading ${url}`, { cause: error });
      }
      integrityFailed ||= error instanceof IntegrityError;
      failures.push(`${url} -> ${extractErrorMessage(error)}`);
    }
  }
  const summary = `all sources failed: ${failures.join('; ')}`;
  throw integrityFailed ? new IntegrityError(summary) : new DownloadError(summary);
}

async function downloadFrom(
  url: string,
  destFile: string,
  digest: SriDigest,
  size: number | undefined,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new DownloadError(`HTTP ${res.status}`);
  if (!res.body) throw new DownloadError('empty response body');
  const totalBytes = size ?? contentLength(res);
  const hash = createHash(digest.algorithm);
  let receivedBytes = 0;
  await pipeline(
    Readable.fromWeb(res.body as NodeReadableStream<Uint8Array>),
    async function* (chunks: AsyncIterable<Buffer>) {
      for await (const chunk of chunks) {
        hash.update(chunk);
        receivedBytes += chunk.length;
        onProgress?.({ receivedBytes, totalBytes });
        yield chunk;
      }
    },
    createWriteStream(destFile),
  );
  const actual = hash.digest('base64');
  if (actual !== digest.digest) {
    throw new IntegrityError(`${digest.algorithm} mismatch (got ${actual})`);
  }
}

function contentLength(res: Response): number | undefined {
  const header = res.headers.get('content-length');
  const length = header === null ? Number.NaN : Number.parseInt(header, 10);
  return Number.isFinite(length) && length > 0 ? length : undefined;
}
