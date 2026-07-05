import type { PreviewRoute, PreviewRouteTable } from '@linkcode/transport';

/**
 * The live hostname → upstream-port table shared between the transport's reverse proxy
 * (reader) and the script service (writer). The daemon constructs one instance and
 * injects it into both; it also carries the daemon's public HTTP port once known, so
 * proxy URLs can be minted after the port hunt settles.
 */
export class PreviewRouteRegistry implements PreviewRouteTable {
  private readonly routes = new Map<string, { target: PreviewRoute; owner: string }>();
  /** The bound daemon HTTP port (set by the daemon after listen); null until known. */
  proxyPort: number | null = null;

  register(hostname: string, target: PreviewRoute, owner: string): void {
    const existing = this.routes.get(hostname);
    if (existing && existing.owner !== owner) {
      throw new Error(`preview hostname ${hostname} is already registered by ${existing.owner}`);
    }
    this.routes.set(hostname, { target, owner });
  }

  unregister(hostname: string, owner: string): void {
    const existing = this.routes.get(hostname);
    if (existing?.owner === owner) this.routes.delete(hostname);
  }

  lookup(hostname: string): PreviewRoute | null {
    return this.routes.get(hostname)?.target ?? null;
  }
}
