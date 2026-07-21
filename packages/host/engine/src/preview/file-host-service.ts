import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { toHostPath } from '@linkcode/common/node';
import type { HostedFile } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import { RequestError } from '../failure';
import type { PreviewRouteRegistry } from './route-registry';

/** LRU cap on hosted files — a runaway conversation can't grow the route table unbounded. */
const MAX_HOSTED_FILES = 128;

const OWNER = 'file-host';

/** Content types the host's browser can play/preview inline; anything else is served as a
 * download (`application/octet-stream`) rather than guessed. Video-first per CODE-316. */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

/**
 * Streams a workspace file over the preview proxy (CODE-316): one `file--<hash>.localhost` origin
 * per absolute path, served with HTTP Range so the host's browser plays large media without a full
 * download. Path-addressed and idempotent; a daemon restart or LRU eviction 404s the URL.
 */
export class FileHostService {
  /** Insertion order doubles as LRU order (re-hosting refreshes by delete+set). */
  private readonly hosted = new Map<string, HostedFile>();
  private closed = false;

  constructor(private readonly routes: PreviewRouteRegistry) {}

  async host(cwd: string, requestPath: string): Promise<HostedFile> {
    if (this.closed) {
      throw new RequestError({ code: 'cancelled', message: 'File hosting is shutting down' });
    }
    const proxyPort = nullthrow(
      this.routes.proxyPort,
      'File hosting is not ready (no bound listener)',
    );

    const resolved = path.resolve(cwd, toHostPath(requestPath));
    const info = await stat(resolved).catch((error: NodeJS.ErrnoException) => {
      throw error.code === 'ENOENT'
        ? new RequestError({ code: 'not_found', message: `File not found: ${requestPath}` })
        : error;
    });
    if (!info.isFile()) {
      throw new RequestError({
        code: 'invalid_request',
        message: `Not a regular file: ${requestPath}`,
      });
    }

    const short = createHash('sha256').update(resolved).digest('hex').slice(0, 16);
    const existing = this.hosted.get(short);
    if (existing) {
      // Refresh LRU position; the same path re-hosts idempotently.
      this.hosted.delete(short);
      this.hosted.set(short, existing);
      return existing;
    }

    const hostname = `file--${short}.localhost`;
    const contentType =
      MIME_BY_EXTENSION[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream';
    const hosted: HostedFile = { hash: short, hostname, url: `http://${hostname}:${proxyPort}/` };
    this.routes.register(hostname, { filePath: resolved, contentType }, OWNER);
    this.hosted.set(short, hosted);

    if (this.hosted.size > MAX_HOSTED_FILES) {
      const oldest = this.hosted.keys().next().value;
      if (oldest !== undefined) this.revoke(oldest);
    }
    return hosted;
  }

  revoke(hash: string): void {
    const hosted = this.hosted.get(hash);
    if (!hosted) return;
    this.routes.unregister(hosted.hostname, OWNER);
    this.hosted.delete(hash);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const hosted of this.hosted.values()) {
      this.routes.unregister(hosted.hostname, OWNER);
    }
    this.hosted.clear();
  }
}
