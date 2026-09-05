import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { OperationError, RequestError } from '../failure';
import type { WireResponder } from '../wire/responder';
import type { LinkCodePluginStore } from './linkcode-store';
import type { LinkCodeMarketplaceService, MarketplaceRefreshResult } from './market-service';

type PluginMarketRequest = Extract<
  WirePayload,
  {
    kind:
      | 'plugin-market.list.get'
      | 'plugin-market.refresh'
      | 'plugin-market.install'
      | 'plugin-market.uninstall';
  }
>;

/** Serves the LinkCode marketplace wire plane: catalog list/refresh and install/uninstall. */
export class LinkCodePluginMarketRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly marketplace: LinkCodeMarketplaceService | undefined,
    private readonly store: LinkCodePluginStore,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: PluginMarketRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'plugin-market.list.get':
        return this.responder.reply(
          payload.clientReqId,
          Effect.sync(() => {
            this.transport.send(
              createWireMessage({
                kind: 'plugin-market.listed',
                replyTo: payload.clientReqId,
                marketplaces: this.marketplace?.list() ?? [],
              }),
            );
          }),
        );
      case 'plugin-market.refresh':
        return this.responder.reply(
          payload.clientReqId,
          this.refresh(payload.marketplaceId).pipe(
            Effect.flatMap((result) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'plugin-market.refreshed',
                    replyTo: payload.clientReqId,
                    marketplaceId: payload.marketplaceId,
                    releases: [...result.releases],
                    ...(result.notModified === true && { notModified: true }),
                  }),
                ),
              ),
            ),
          ),
        );
      case 'plugin-market.install':
        return this.responder.reply(payload.clientReqId, this.install(payload));
      case 'plugin-market.uninstall':
        return this.responder.reply(
          payload.clientReqId,
          Effect.tryPromise({
            try: async () => {
              await this.store.uninstall(payload.pluginId);
              this.transport.send(
                createWireMessage({
                  kind: 'plugin-market.uninstalled',
                  replyTo: payload.clientReqId,
                  pluginId: payload.pluginId,
                }),
              );
            },
            catch: (cause) =>
              new OperationError({
                subsystem: 'store',
                operation: 'plugin-market.uninstall',
                publicMessage: 'Failed to uninstall the plugin',
                cause,
              }),
          }),
        );
      default:
        return Effect.void;
    }
  }

  private refresh(
    marketplaceId: string,
  ): Effect.Effect<MarketplaceRefreshResult, RequestError | OperationError> {
    return Effect.suspend(
      (): Effect.Effect<MarketplaceRefreshResult, RequestError | OperationError> => {
        const marketplace = this.marketplace;
        if (marketplace === undefined) {
          return Effect.fail(
            new RequestError({
              code: 'unsupported',
              message: 'Plugin marketplaces are unavailable on this host',
            }),
          );
        }
        const config = marketplace.list().find((entry) => entry.id === marketplaceId);
        if (config === undefined) {
          return Effect.fail(
            new RequestError({
              code: 'not_found',
              message: `Unknown marketplace: ${marketplaceId}`,
            }),
          );
        }
        if (!config.enabled) {
          return Effect.fail(
            new RequestError({
              code: 'forbidden',
              message: `Marketplace is disabled: ${marketplaceId}`,
            }),
          );
        }
        return Effect.tryPromise({
          try: () => marketplace.refresh(marketplaceId),
          catch: (cause) =>
            new OperationError({
              subsystem: 'plugin',
              operation: 'plugin-market.refresh',
              publicMessage: 'Failed to refresh the marketplace index',
              cause,
            }),
        });
      },
    );
  }

  private install(
    payload: Extract<PluginMarketRequest, { kind: 'plugin-market.install' }>,
  ): Effect.Effect<void, RequestError | OperationError> {
    return Effect.suspend((): Effect.Effect<void, RequestError | OperationError> => {
      const marketplace = this.marketplace;
      if (marketplace === undefined) {
        return Effect.fail(
          new RequestError({
            code: 'unsupported',
            message: 'Plugin marketplaces are unavailable on this host',
          }),
        );
      }
      const config = marketplace.list().find((entry) => entry.id === payload.release.marketplaceId);
      if (config === undefined) {
        return Effect.fail(
          new RequestError({
            code: 'not_found',
            message: `Unknown marketplace: ${payload.release.marketplaceId}`,
          }),
        );
      }
      if (!config.enabled) {
        return Effect.fail(
          new RequestError({
            code: 'forbidden',
            message: `Marketplace is disabled: ${payload.release.marketplaceId}`,
          }),
        );
      }
      const release = marketplace.resolveRelease(payload.release);
      if (release === undefined) {
        return Effect.fail(
          new RequestError({
            code: 'not_found',
            message: `Unknown marketplace release: ${payload.release.pluginId}@${payload.release.version}`,
          }),
        );
      }
      const identity = payload.release;
      return Effect.tryPromise({
        try: async () => {
          await this.store.install(release, identity.marketplaceId);
          this.transport.send(
            createWireMessage({
              kind: 'plugin-market.installed',
              replyTo: payload.clientReqId,
              marketplaceId: identity.marketplaceId,
              pluginId: identity.pluginId,
              version: identity.version,
            }),
          );
        },
        catch: (cause) =>
          new OperationError({
            subsystem: 'store',
            operation: 'plugin-market.install',
            publicMessage: 'Failed to install the plugin',
            cause,
          }),
      });
    });
  }
}
