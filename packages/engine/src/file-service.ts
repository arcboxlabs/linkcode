import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { WorkspaceFile } from '@linkcode/schema';

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

/**
 * Read a file for a client, contained to the workspace directory. Containment is
 * enforced on the *realpath* of both ends, so a symlink inside the workspace cannot
 * escape it (the paseo file-explorer precedent). Throws (→ `sendFailure`) on escape,
 * oversize, or a non-file target.
 */
export async function readWorkspaceFile(cwd: string, requestPath: string): Promise<WorkspaceFile> {
  const root = await realpath(cwd);
  const resolved = await realpath(path.resolve(root, requestPath));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes the workspace: ${requestPath}`);
  }

  // Open first, stat the handle: no window between the containment check and the read.
  const handle = await open(resolved, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Not a regular file: ${requestPath}`);
    if (stat.size > MAX_FILE_READ_BYTES) {
      throw new Error(`File exceeds the ${MAX_FILE_READ_BYTES / 1024 / 1024} MB read limit`);
    }

    const buffer = Buffer.alloc(stat.size);
    await handle.read(buffer, 0, stat.size, 0);

    const binary = isBinary(buffer);
    return {
      path: resolved,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      encoding: binary ? 'base64' : 'utf8',
      content: buffer.toString(binary ? 'base64' : 'utf8'),
      mimeType: MIME_BY_EXTENSION[path.extname(resolved).toLowerCase()],
    };
  } finally {
    await handle.close();
  }
}

function isBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < end; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}
