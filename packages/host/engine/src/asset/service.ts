import type {
  AssetInstallEvent,
  InstalledAsset,
  ManagedAssetId,
  ManagedAssetKey,
  ManagedAssetStatus,
  WirePayload,
} from '@linkcode/schema';
import { managedAssetIdEquals, managedAssetKey } from '@linkcode/schema';
import type { Transport, Unsubscribe } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { OperationError, RequestError } from '../failure';
import type { WireResponder } from '../wire/responder';

type AssetRequest = Extract<WirePayload, { kind: 'asset.list' | 'asset.ensure' }>;

/** The slice of the daemon's AssetManager consumed by the engine. */
export interface AssetService {
  statuses(): ManagedAssetStatus[];
  ensure(id: ManagedAssetId): Promise<InstalledAsset | undefined>;
  subscribe(listener: (event: AssetInstallEvent) => void): Unsubscribe;
}

/** Progress broadcasts are throttled per asset so a fast download cannot flood the wire. */
const PROGRESS_INTERVAL_MS = 150;

export class ManagedAssetService {
  private readonly progressSentAt = new Map<ManagedAssetKey, number>();
  private unsubscribe?: Unsubscribe;

  constructor(
    private readonly transport: Transport,
    private readonly assets: AssetService | undefined,
    private readonly onAgentInstalled: () => void,
    private readonly responder: WireResponder,
  ) {}

  start(): void {
    this.unsubscribe ??= this.assets?.subscribe((event) => this.onInstallEvent(event));
  }

  handle(payload: AssetRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'asset.list':
        return Effect.sync(() =>
          this.transport.send(
            createWireMessage({
              kind: 'asset.listed',
              replyTo: payload.clientReqId,
              assets: this.assets?.statuses() ?? [],
            }),
          ),
        );
      case 'asset.ensure':
        return this.responder.reply(
          payload.clientReqId,
          this.ensure(payload.id).pipe(
            Effect.flatMap((status) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'asset.ensured',
                    replyTo: payload.clientReqId,
                    status,
                  }),
                ),
              ),
            ),
          ),
        );
      default:
        return Effect.void;
    }
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private ensure(
    id: ManagedAssetId,
  ): Effect.Effect<ManagedAssetStatus, RequestError | OperationError> {
    const assets = this.assets;
    if (!assets) {
      return Effect.fail(
        new RequestError({
          code: 'unsupported',
          message: 'Managed assets are unavailable on this host',
        }),
      );
    }

    return Effect.gen(function* () {
      const installed = yield* Effect.tryPromise({
        try: () => assets.ensure(id),
        catch: assetEnsureFailure,
      });
      if (!installed) {
        return yield* Effect.fail(
          new RequestError({
            code: 'unsupported',
            message: `Asset ${managedAssetKey(id)} cannot be installed here`,
          }),
        );
      }
      const status = yield* Effect.try({
        try: () => assets.statuses().find((candidate) => managedAssetIdEquals(candidate.id, id)),
        catch: assetEnsureFailure,
      });
      if (!status) {
        return yield* Effect.fail(
          assetEnsureFailure(new Error(`Missing installed status for ${managedAssetKey(id)}`)),
        );
      }
      return status;
    });
  }

  private onInstallEvent(event: AssetInstallEvent): void {
    switch (event.kind) {
      case 'progress': {
        const now = Date.now();
        const key = managedAssetKey(event.id);
        if (now - (this.progressSentAt.get(key) ?? 0) < PROGRESS_INTERVAL_MS) return;
        this.progressSentAt.set(key, now);
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
        this.progressSentAt.delete(managedAssetKey(event.id));
        this.transport.send(
          createWireMessage({ kind: 'asset.settled', id: event.id, installed: event.installed }),
        );
        if (event.id.kind === 'agent') this.onAgentInstalled();
        break;
      }
      case 'failed': {
        this.progressSentAt.delete(managedAssetKey(event.id));
        this.transport.send(
          createWireMessage({ kind: 'asset.settled', id: event.id, error: event.error }),
        );
        break;
      }
      // no default
    }
  }
}

function assetEnsureFailure(cause: unknown): OperationError {
  return new OperationError({
    subsystem: 'asset',
    operation: 'asset.ensure',
    publicMessage: 'Asset installation failed',
    cause,
  });
}
