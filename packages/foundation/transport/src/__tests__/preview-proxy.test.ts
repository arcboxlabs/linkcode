import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPreviewRequestHandler, parseByteRange } from '../preview-proxy';
import type { PreviewRouteTable } from '../preview-routes';

describe('parseByteRange', () => {
  const size = 100;
  it('returns null when no range applies', () => {
    expect(parseByteRange(undefined, size)).toBeNull();
    expect(parseByteRange('bytes=-', size)).toBeNull();
    expect(parseByteRange('items=0-9', size)).toBeNull();
  });

  it('resolves explicit, open-ended, and suffix ranges', () => {
    expect(parseByteRange('bytes=0-9', size)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange('bytes=10-', size)).toEqual({ start: 10, end: 99 });
    expect(parseByteRange('bytes=-20', size)).toEqual({ start: 80, end: 99 });
  });

  it('clamps an end past EOF and flags unsatisfiable ranges', () => {
    expect(parseByteRange('bytes=90-999', size)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=100-101', size)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', size)).toBe('unsatisfiable');
  });
});

describe('preview file route serving', () => {
  let dir: string;
  let filePath: string;
  let port: number;
  let server: ReturnType<typeof createServer>;
  const body = Buffer.from('0123456789abcdef');

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'preview-file-'));
    filePath = join(dir, 'clip.bin');
    await writeFile(filePath, body);
    const routes: PreviewRouteTable = {
      lookup: (hostname) =>
        hostname === 'file--abc.localhost' ? { filePath, contentType: 'video/mp4' } : null,
    };
    const handler = createPreviewRequestHandler(routes, (_req, res) => {
      res.writeHead(500);
      res.end('fallback');
    });
    server = createServer(handler);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await rm(dir, { recursive: true, force: true });
  });

  // `fetch` strips the forbidden `host` header, so drive the request with node:http to
  // reach the preview classifier.
  const request = (
    headers: Record<string, string> = {},
  ): Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }> =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/',
          headers: { host: 'file--abc.localhost', ...headers },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
          });
        },
      );
      req.on('error', reject);
      req.end();
    });

  it('serves the whole file with Accept-Ranges when no range is requested', async () => {
    const res = await request();
    expect(res.status).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-type']).toBe('video/mp4');
    expect(res.headers['content-length']).toBe(String(body.length));
    expect(res.body).toEqual(body);
  });

  it('serves a zero-length file without constructing an invalid stream range', async () => {
    await writeFile(filePath, Buffer.alloc(0));
    try {
      const res = await request();
      expect(res.status).toBe(200);
      expect(res.headers['content-length']).toBe('0');
      expect(res.body).toEqual(Buffer.alloc(0));
    } finally {
      await writeFile(filePath, body);
    }
  });

  it('serves a partial 206 for a byte range', async () => {
    const res = await request({ range: 'bytes=4-7' });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 4-7/${body.length}`);
    expect(res.body.toString()).toBe('4567');
  });

  it('returns 416 for an unsatisfiable range', async () => {
    const res = await request({ range: 'bytes=999-' });
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe(`bytes */${body.length}`);
  });

  it('404s a route whose file is gone', async () => {
    await rm(filePath);
    const res = await request();
    expect(res.status).toBe(404);
    await writeFile(filePath, body);
  });
});
