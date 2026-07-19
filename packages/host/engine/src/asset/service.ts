import type {
  AssetInstallEvent,
  InstalledAsset,
  ManagedAssetId,
  ManagedAssetStatus,
} from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { nullthrow } from 'foxts/guard';
import { OperationError, RequestError } from '../failure';
import type { WireResponder } from '../wire/responder';

/** The slice of the daemon's AssetManager consumed by the engine. */
export interface AssetService {
  statuses(): ManagedAssetStatus[];
  ensure(id: ManagedAssetId): Promise<InstalledAsset | undefined>;
  subscribe(listener: (event: AssetInstallEvent) => void): Unsubscribe;
}

/** Progress broadcasts are throttled per asset so a fast download cannot flood the wire. */
const PROGRESS_INTERVAL_MS = 150;

export class ManagedAssetService {
  private readonly progressSentAt = new Map<ManagedAssetId, number>();
  private readonly unsubscribe?: Unsubscribe;

  constructor(
    private readonly transport: Transport,
    private readonly assets: AssetService | undefined,
    private readonly onAgentInstalled: () => void,
    private readonly responder: WireResponder,
  ) {
    this.unsubscribe = assets?.subscribe((event) => this.onInstallEvent(event));
  }

  list(replyTo: string): void {
    this.transport.send(
      createWireMessage({
        kind: 'asset.listed',
        replyTo,
        assets: this.assets?.statuses() ?? [],
      }),
    );
  }

  ensure(replyTo: string, id: ManagedAssetId): void {
    const assets = this.assets;
    if (!assets) {
      this.responder.sendFailure(
        replyTo,
        new RequestError({
          code: 'unsupported',
          message: 'Managed assets are unavailable on this host',
        }),
      );
      return;
    }
    // Do not await: the reply lands only when the potentially minutes-long install settles,
    // while the engine must remain free to process other messages.
    assets
      .ensure(id)
      .then((installed) => {
        if (!installed) {
          this.responder.sendFailure(
            replyTo,
            new RequestError({
              code: 'unsupported',
              message: `Asset ${id} cannot be installed here`,
            }),
          );
          return;
        }
        const status = nullthrow(
          assets.statuses().find((candidate) => candidate.id === id),
          `installed asset ${id} missing from statuses`,
        );
        this.transport.send(createWireMessage({ kind: 'asset.ensured', replyTo, status }));
      })
      .catch((error: unknown) =>
        this.responder.sendFailure(
          replyTo,
          new OperationError({
            subsystem: 'asset',
            operation: 'asset.ensure',
            publicMessage: 'Asset installation failed',
            cause: error,
          }),
        ),
      );
  }

  close(): void {
    this.unsubscribe?.();
  }

  private onInstallEvent(event: AssetInstallEvent): void {
    switch (event.kind) {
      case 'progress': {
        const now = Date.now();
        if (now - (this.progressSentAt.get(event.id) ?? 0) < PROGRESS_INTERVAL_MS) return;
        this.progressSentAt.set(event.id, now);
        this.transport.send(
          createWireMessage({
            kind: 'asset.progress',
            id: event.id,
            receivedBytes: event.receivedBytes,
            totalBytes: event.totalBytes,
          }),
        );
        break;
      }
      case 'installed': {
        this.progressSentAt.delete(event.id);
        this.transport.send(
          createWireMessage({ kind: 'asset.settled', id: event.id, installed: event.installed }),
        );
        if (event.id.startsWith('agent:')) this.onAgentInstalled();
        break;
      }
      case 'failed': {
        this.progressSentAt.delete(event.id);
        this.transport.send(
          createWireMessage({ kind: 'asset.settled', id: event.id, error: event.error }),
        );
        break;
      }
      // no default
    }
  }
}
