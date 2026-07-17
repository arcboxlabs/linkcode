import { createHash } from 'node:crypto';
import type { HostedArtifact } from '@linkcode/schema';
import { nullthrow } from 'foxts/guard';
import type { PreviewRouteRegistry } from '../scripts/route-registry';

/** LRU cap on hosted artifacts — a runaway conversation can't grow daemon memory unbounded. */
const MAX_HOSTED_ARTIFACTS = 128;

const OWNER = 'artifact-host';

/**
 * Ephemeral artifact hosting (CODE-62): content-addressed in-memory documents served via the
 * preview proxy, one `artifact--<hash>.localhost` origin each so same-origin policy isolates
 * them. A daemon restart, LRU eviction, or explicit revoke 404s the URL.
 */
export class ArtifactHostService {
  /** Insertion order doubles as LRU order (re-hosting refreshes by delete+set). */
  private readonly hosted = new Map<string, HostedArtifact>();

  constructor(private readonly routes: PreviewRouteRegistry) {}

  host(content: string, mimeType: string): HostedArtifact {
    const proxyPort = nullthrow(
      this.routes.proxyPort,
      'Artifact hosting is not ready (no bound listener)',
    );

    const hash = createHash('sha256').update(mimeType).update('\0').update(content).digest('hex');
    const short = hash.slice(0, 16);
    const existing = this.hosted.get(short);
    if (existing) {
      // Refresh LRU position; identical content is idempotent.
      this.hosted.delete(short);
      this.hosted.set(short, existing);
      return existing;
    }

    const hostname = `artifact--${short}.localhost`;
    const artifact: HostedArtifact = {
      hash: short,
      hostname,
      url: `http://${hostname}:${proxyPort}/`,
    };
    this.routes.register(hostname, { body: content, contentType: mimeType }, OWNER);
    this.hosted.set(short, artifact);

    if (this.hosted.size > MAX_HOSTED_ARTIFACTS) {
      const oldest = this.hosted.keys().next().value;
      if (oldest !== undefined) this.revoke(oldest);
    }
    return artifact;
  }

  revoke(hash: string): void {
    const artifact = this.hosted.get(hash);
    if (!artifact) return;
    this.routes.unregister(artifact.hostname, OWNER);
    this.hosted.delete(hash);
  }
}
