import type {
  BrowserCommandArgs,
  BrowserCommandResult,
  BrowserOp,
  WirePayload,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import type { PendingRegistry, RandomUUID } from './pending-registry';
import { sendCorrelated } from './pending-registry';

export type BrowserCommandExecutor = (
  op: BrowserOp,
  args: BrowserCommandArgs,
) => Promise<BrowserCommandResult>;

/**
 * Registers this client as THE single active browser host (CODE-267) and runs
 * broker-dispatched `browser.command` frames through the host-supplied executor.
 * Only the desktop client registers; browser/mobile clients never do.
 */
export class BrowserHostChannel {
  private executor: BrowserCommandExecutor | null = null;
  private hostId: string | null = null;
  private hostSecret: string | null = null;

  constructor(
    private readonly transport: Transport,
    private readonly pending: PendingRegistry,
    private readonly randomUUID: RandomUUID,
  ) {}

  /** Claim the browser-host role; call again after a reconnect (last registration wins daemon-side). */
  async register(executor: BrowserCommandExecutor): Promise<void> {
    this.executor = executor;
    this.hostId ??= this.randomUUID();
    this.hostSecret ??= this.randomUUID();
    const hostId = this.hostId;
    const hostSecret = this.hostSecret;
    await sendCorrelated(this.transport, this.pending, 'ack', (clientReqId) => ({
      kind: 'browser.host.register',
      clientReqId,
      hostId,
      hostSecret,
    }));
  }

  /** Route a `browser.*` host push. Returns false if `payload` wasn't one. */
  handleMessage(p: WirePayload): boolean {
    if (p.kind !== 'browser.command') return false;
    void this.run(p.commandId, p.op, p.args);
    return true;
  }

  private async run(commandId: string, op: BrowserOp, args: BrowserCommandArgs): Promise<void> {
    const executor = this.executor;
    const result: BrowserCommandResult = executor
      ? await executor(op, args).catch((err: unknown) => ({
          ok: false as const,
          error: {
            code: 'execution-failed' as const,
            message: extractErrorMessage(err) ?? 'Unknown executor error',
            retryable: false,
          },
        }))
      : {
          ok: false,
          error: {
            code: 'execution-failed',
            message: 'no browser executor is installed on this host',
            retryable: false,
          },
        };
    try {
      // Best-effort settle: if the send is lost the broker's timeout answers instead.
      await this.transport.send(
        createWireMessage({ kind: 'browser.command.result', commandId, result }),
      );
    } catch {
      noop();
    }
  }
}
