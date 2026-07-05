import { describe, expect, it } from 'vitest';
import { ArtifactHostService } from '../artifacts/host-service';
import { PreviewRouteRegistry } from '../scripts/route-registry';

function makeService(): { service: ArtifactHostService; routes: PreviewRouteRegistry } {
  const routes = new PreviewRouteRegistry();
  routes.proxyPort = 19523;
  return { service: new ArtifactHostService(routes), routes };
}

describe('ArtifactHostService', () => {
  it('hosts content under a content-addressed origin and serves it via the route table', () => {
    const { service, routes } = makeService();
    const artifact = service.host('<h1>hi</h1>', 'text/html; charset=utf-8');

    expect(artifact.hostname).toBe(`artifact--${artifact.hash}.localhost`);
    expect(artifact.url).toBe(`http://${artifact.hostname}:19523/`);
    expect(routes.lookup(artifact.hostname)).toEqual({
      body: '<h1>hi</h1>',
      contentType: 'text/html; charset=utf-8',
    });
  });

  it('is idempotent for identical content and distinct per content/mime', () => {
    const { service } = makeService();
    const a = service.host('<p>x</p>', 'text/html');
    const b = service.host('<p>x</p>', 'text/html');
    const c = service.host('<p>y</p>', 'text/html');
    const d = service.host('<p>x</p>', 'text/plain');
    expect(b).toEqual(a);
    expect(c.hash).not.toBe(a.hash);
    expect(d.hash).not.toBe(a.hash);
  });

  it('revoke removes the route (404 downstream)', () => {
    const { service, routes } = makeService();
    const artifact = service.host('<p>gone</p>', 'text/html');
    service.revoke(artifact.hash);
    expect(routes.lookup(artifact.hostname)).toBeNull();
  });

  it('evicts the least-recently-hosted artifact past the cap', () => {
    const { service, routes } = makeService();
    const first = service.host('<p>0</p>', 'text/html');
    for (let i = 1; i <= 128; i += 1) service.host(`<p>${i}</p>`, 'text/html');
    expect(routes.lookup(first.hostname)).toBeNull();
  });

  it('refuses to host before a listener port is known', () => {
    const routes = new PreviewRouteRegistry();
    const service = new ArtifactHostService(routes);
    expect(() => service.host('<p>x</p>', 'text/html')).toThrow('not ready');
  });
});
