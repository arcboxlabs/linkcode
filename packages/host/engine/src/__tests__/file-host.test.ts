import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestError } from '../failure';
import { FileHostService } from '../preview/file-host-service';
import { PreviewRouteRegistry } from '../preview/route-registry';

function makeService(): { service: FileHostService; routes: PreviewRouteRegistry } {
  const routes = new PreviewRouteRegistry();
  routes.proxyPort = 19523;
  return { service: new FileHostService(routes), routes };
}

describe('FileHostService', () => {
  let dir: string;
  let clip: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'file-host-'));
    clip = join(dir, 'clip.mp4');
    await writeFile(clip, 'binary');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('hosts a file under a path-addressed origin with an extension-derived mime', async () => {
    const { service, routes } = makeService();
    const hosted = await service.host(dir, 'clip.mp4');

    expect(hosted.hostname).toBe(`file--${hosted.hash}.localhost`);
    expect(hosted.url).toBe(`http://${hosted.hostname}:19523/`);
    expect(routes.lookup(hosted.hostname)).toEqual({ filePath: clip, contentType: 'video/mp4' });
  });

  it('is idempotent for the same resolved path', async () => {
    const { service } = makeService();
    const a = await service.host(dir, 'clip.mp4');
    const b = await service.host(dir, './clip.mp4');
    expect(b).toEqual(a);
  });

  it('falls back to octet-stream for unknown extensions', async () => {
    const { service, routes } = makeService();
    await writeFile(join(dir, 'data.bin'), 'x');
    const hosted = await service.host(dir, 'data.bin');
    expect(routes.lookup(hosted.hostname)).toMatchObject({
      contentType: 'application/octet-stream',
    });
  });

  it('rejects a missing file as not_found', async () => {
    const { service } = makeService();
    await expect(service.host(dir, 'nope.mp4')).rejects.toThrow(RequestError);
    await expect(service.host(dir, 'nope.mp4')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects a directory as invalid_request', async () => {
    const { service } = makeService();
    await expect(service.host(dir, '.')).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('refuses to host before a listener port is known', async () => {
    const service = new FileHostService(new PreviewRouteRegistry());
    await expect(service.host(dir, 'clip.mp4')).rejects.toThrow('not ready');
  });
});
