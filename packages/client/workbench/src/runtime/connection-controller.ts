import type {
  ConnectionControllerOptions,
  ConnectionGeneration,
  ConnectionSnapshot,
  ConnectionSource,
  ConnectionStatus,
  ResolvedConnection,
} from '@linkcode/client-core';
import { ConnectionController } from '@linkcode/client-core';
import type { LinkCodeSdkClient } from '@linkcode/sdk';
import { createClient, setDefaultClient } from '@linkcode/sdk';
import type { Transport } from '@linkcode/transport';
import { captureProductEvent } from '../analytics/product-analytics';

export type ResolvedWorkbenchConnection = ResolvedConnection;
export type WorkbenchConnectionSource = ConnectionSource;
export type WorkbenchRuntimeStatus = ConnectionStatus;
export type WorkbenchConnectionGeneration = ConnectionGeneration<LinkCodeSdkClient>;
export type WorkbenchConnectionSnapshot = ConnectionSnapshot<LinkCodeSdkClient>;

type WorkbenchConnectionControllerOptions = Partial<
  Pick<ConnectionControllerOptions<LinkCodeSdkClient>, 'createClient' | 'retry'>
>;

/**
 * The workbench binding of the shared {@link ConnectionController}: an SDK client per generation,
 * promoted into the ambient default that tayori reads, with connection outcomes reported to
 * product analytics.
 */
export class WorkbenchConnectionController extends ConnectionController<LinkCodeSdkClient> {
  constructor(
    source: WorkbenchConnectionSource,
    options: WorkbenchConnectionControllerOptions = {},
  ) {
    super(source, {
      createClient: options.createClient ?? ((transport: Transport) => createClient({ transport })),
      onOutcome(outcome) {
        if (outcome.status === 'ready') {
          captureProductEvent('host connection ready', {
            attempt: outcome.attempt,
            duration_ms: outcome.durationMs,
            recovered: outcome.recovered,
          });
        } else {
          captureProductEvent('host connection failed', {
            attempt: outcome.attempt,
            duration_ms: outcome.durationMs,
          });
        }
      },
      onPromote: setDefaultClient,
      retry: options.retry,
    });
  }
}
