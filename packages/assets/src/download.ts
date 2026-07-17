/// <reference types="node" />
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ManagedAssetArtifact } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import fetch from 'make-fetch-happen';
import ssri from 'ssri';
import './mfh-augment';
import { DownloadError, IntegrityError } from './errors';

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes?: number;
}

export interface DownloadOptions {
  onProgress?: (progress: DownloadProgress) => void;
  /** Per-source retry count (network/5xx with backoff; 4xx fails fast to the next source). */
  retry?: number;
}

/** Whole-body ceiling; the largest artifact (codex, ~94 MB) fits comfortably on slow links. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60000;
const DEFAULT_RETRY = 2;

const INTEGRITY_CODES = new Set(['EINTEGRITY', 'EBADSIZE']);

/**
 * Download to `destFile`, walking the ordered source list until one delivers SRI-verified
 * bytes (make-fetch-happen transport: per-source retry + proxy env support). The body streams
 * through `ssri.integrityStream` and the destination is deleted on any failure, so a truncated
 * or tampered transfer never leaves a "valid" file. An integrity mismatch fails just that
 * source but surfaces as `IntegrityError` when no source survives; ENOSPC aborts the walk.
 */
export async function downloadVerified(
  artifact: ManagedAssetArtifact,
  destFile: string,
  options: DownloadOptions = {},
): Promise<void> {
  const failures: string[] = [];
  let integrityFailed = false;
  for (const url of artifact.urls) {
    try {
      // eslint-disable-next-line no-await-in-loop -- urls are an ordered fallback list
      await downloadFrom(url, destFile, artifact, options);
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
  artifact: ManagedAssetArtifact,
  options: DownloadOptions,
): Promise<void> {
  const res = await fetch(url, {
    retry: options.retry ?? DEFAULT_RETRY,
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!res.ok) throw new DownloadError(`HTTP ${res.status}`);
  const totalBytes = artifact.size ?? contentLength(res.headers.get('content-length'));
  let receivedBytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      options.onProgress?.({ receivedBytes, totalBytes });
      callback(null, chunk);
    },
  });
  const verify = ssri.integrityStream({ integrity: artifact.integrity, size: artifact.size });
  try {
    await pipeline(res.body, verify, counter, createWriteStream(destFile));
  } catch (error) {
    if (INTEGRITY_CODES.has((error as NodeJS.ErrnoException).code ?? '')) {
      throw new IntegrityError(extractErrorMessage(error) ?? 'integrity check failed', {
        cause: error,
      });
    }
    throw error;
  }
}

function contentLength(header: string | null): number | undefined {
  const length = header === null ? Number.NaN : Number.parseInt(header, 10);
  return Number.isFinite(length) && length > 0 ? length : undefined;
}
