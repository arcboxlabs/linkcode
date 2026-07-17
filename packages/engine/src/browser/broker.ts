import { randomUUID } from 'node:crypto';
import type { BrowserCommandArgs, BrowserCommandResult, BrowserOp } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';

const COMMAND_TIMEOUT_MS = 15000;

interface PendingCommand {
  resolve: (result: BrowserCommandResult) => void;
  timer: NodeJS.Timeout;
}

/**
 * Dispatches browser ops to the single registered desktop host (CODE-267). The Hub owns
 * connection-level targeting (`browser.command` frames reach only the host connection); this
 * service owns the request/settlement correlation, the timeout, and availability broadcasts.
 * `dispatch` never rejects — every failure is a closed-code {@link BrowserCommandResult}.
 */
export class BrowserBrokerService {
  private hostId: string | null = null;
  private readonly pending = new Map<string, PendingCommand>();

  constructor(private readonly transport: Transport) {}

  get available(): boolean {
    return this.hostId !== null;
  }

  /** Last registration wins; commands still pending against the previous host are failed. */
  registerHost(hostId: string): void {
    if (this.hostId !== null && this.hostId !== hostId) {
      this.failAllPending('superseded by a new browser host');
    }
    this.hostId = hostId;
    this.broadcastAvailability();
  }

  /** Hub-synthesized on host disconnect; a stale (already superseded) hostId is ignored. */
  detachHost(hostId: string): void {
    if (this.hostId !== hostId) return;
    this.hostId = null;
    this.failAllPending('the browser host disconnected');
    this.broadcastAvailability();
  }

  settle(commandId: string, result: BrowserCommandResult): void {
    const pending = this.pending.get(commandId);
    if (!pending) return;
    this.pending.delete(commandId);
    clearTimeout(pending.timer);
    pending.resolve(result);
  }

  dispatch(op: BrowserOp, args: BrowserCommandArgs): Promise<BrowserCommandResult> {
    if (this.hostId === null) {
      return Promise.resolve(
        failure('host-unavailable', 'no desktop client is registered as the browser host'),
      );
    }
    const commandId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        resolve(
          failure('timeout', `the browser host did not answer within ${COMMAND_TIMEOUT_MS}ms`),
        );
      }, COMMAND_TIMEOUT_MS);
      timer.unref();
      this.pending.set(commandId, { resolve, timer });
      this.transport.send(createWireMessage({ kind: 'browser.command', commandId, op, args }));
    });
  }

  shutdown(): void {
    this.failAllPending('the daemon is shutting down');
    this.hostId = null;
  }

  private failAllPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve(failure('host-unavailable', message));
    }
    this.pending.clear();
  }

  private broadcastAvailability(): void {
    this.transport.send(
      createWireMessage({ kind: 'browser.host.changed', available: this.available }),
    );
  }
}

function failure(code: 'host-unavailable' | 'timeout', message: string): BrowserCommandResult {
  return { ok: false, error: { code, message, retryable: true } };
}
