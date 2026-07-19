import { open } from 'node:fs/promises';
import path from 'node:path';
import { toHostPath } from '@linkcode/common/node';
import type { WorkspaceFile } from '@linkcode/schema';
import { Effect } from 'effect';
import type { EngineFailure } from '../failure';
import { RequestError, toOperationFailure } from '../failure';

/** Hard cap on a single read; the wire is JSON, so oversized payloads hurt every client. */
export const MAX_FILE_READ_BYTES = 10 * 1024 * 1024;

/** Sniff window for the binary check (a NUL byte in the head marks the file binary). */
const BINARY_SNIFF_BYTES = 8192;

/** Extension → mime for the types the client viewers understand; everything else is
 * served without a mimeType and the client falls back on the utf8/base64 encoding. */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.html': 'text/html',
};

/** Read a file for a client's viewer. `requestPath` resolves against the workspace directory but
 * may point anywhere the daemon user can read — agents legitimately write outside the workspace;
 * remote access must gate reads in its own authz layer, not here. Expected request and filesystem
 * failures stay in the Effect error channel for the wire responder. */
export const readWorkspaceFile: (
  cwd: string,
  requestPath: string,
) => Effect.Effect<WorkspaceFile, EngineFailure> = Effect.fn('File.read')(function* (
  cwd: string,
  requestPath: string,
) {
  // Backstop for MSYS drive-form paths (`/c/…`): sessions persisted before adapter-side
  // normalization still replay them, and win32 `resolve` would misread the rooted POSIX form
  // as drive-relative (`C:\c\…`).
  const resolved = path.resolve(cwd, toHostPath(requestPath));

  return yield* Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => open(resolved, 'r'),
      catch: (cause) =>
        (cause as NodeJS.ErrnoException).code === 'ENOENT'
          ? new RequestError({ code: 'not_found', message: `File not found: ${requestPath}` })
          : toOperationFailure(cause, {
              subsystem: 'filesystem',
              operation: 'file.open',
              publicMessage: 'Failed to open workspace file',
            }),
    }),
    (handle) =>
      Effect.gen(function* () {
        const stat = yield* filesystemOperation(
          'file.stat',
          'Failed to inspect workspace file',
          () => handle.stat(),
        );
        if (!stat.isFile()) {
          return yield* new RequestError({
            code: 'invalid_request',
            message: `Not a regular file: ${requestPath}`,
          });
        }
        if (stat.size > MAX_FILE_READ_BYTES) {
          return yield* new RequestError({
            code: 'limit_exceeded',
            message: `File exceeds the ${MAX_FILE_READ_BYTES / 1024 / 1024} MB read limit`,
          });
        }

        const buffer = Buffer.alloc(stat.size);
        yield* filesystemOperation('file.read', 'Failed to read workspace file', () =>
          handle.read(buffer, 0, stat.size, 0),
        );

        const mimeType = MIME_BY_EXTENSION[path.extname(resolved).toLowerCase()];
        // Known-binary types (PDF, raster images) must round-trip as base64 even when no NUL lands
        // in the sniff window — a utf8 decode would corrupt the bytes. SVG stays text (it's XML).
        const binary = isBinary(buffer) || isBinaryMime(mimeType);
        return {
          path: resolved,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          encoding: binary ? ('base64' as const) : ('utf8' as const),
          content: buffer.toString(binary ? 'base64' : 'utf8'),
          mimeType,
        };
      }),
    (handle) =>
      filesystemOperation('file.close', 'Failed to close workspace file', () => handle.close()),
  );
});

function filesystemOperation<A>(
  operation: string,
  publicMessage: string,
  run: () => Promise<A>,
): Effect.Effect<A, EngineFailure> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      toOperationFailure(cause, { subsystem: 'filesystem', operation, publicMessage }),
  });
}

function isBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** MIME types whose bytes are always binary regardless of the NUL sniff (PDF, raster images). */
function isBinaryMime(mime: string | undefined): boolean {
  if (!mime) return false;
  return mime === 'application/pdf' || (mime.startsWith('image/') && mime !== 'image/svg+xml');
}
