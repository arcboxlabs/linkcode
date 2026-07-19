import type { WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { toOperationFailure } from '../failure';
import type { WireResponder } from '../wire/responder';
import type { GitService } from './git-service';

type GitRequest = Extract<
  WirePayload,
  { kind: 'git.status.get' | 'git.pr_status.get' | 'git.diff.get' }
>;

/** Translates inbound git requests into cached local and provider reads. */
export class GitRequestHandler {
  constructor(
    private readonly transport: Transport,
    private readonly git: GitService,
    private readonly responder: WireResponder,
  ) {}

  handle(payload: GitRequest): Effect.Effect<void> {
    switch (payload.kind) {
      case 'git.status.get':
        return this.responder.reply(
          payload.clientReqId,
          gitOperation('git.status', 'Failed to read git status', () =>
            this.git.getStatus(payload.cwd),
          ).pipe(
            Effect.flatMap((status) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'git.status.get.result',
                    replyTo: payload.clientReqId,
                    status,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'git.pr_status.get':
        return this.responder.reply(
          payload.clientReqId,
          gitOperation('git.pr-status', 'Failed to read pull request status', () =>
            this.git.getPullRequestStatus(payload.cwd),
          ).pipe(
            Effect.flatMap((prStatus) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'git.pr_status.get.result',
                    replyTo: payload.clientReqId,
                    prStatus,
                  }),
                ),
              ),
            ),
          ),
        );
      case 'git.diff.get':
        return this.responder.reply(
          payload.clientReqId,
          gitOperation('git.diff', 'Failed to read git diff', () =>
            this.git.getDiff(payload.cwd, payload.mode),
          ).pipe(
            Effect.flatMap((diff) =>
              Effect.sync(() =>
                this.transport.send(
                  createWireMessage({
                    kind: 'git.diff.get.result',
                    replyTo: payload.clientReqId,
                    diff,
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
}

function gitOperation<A>(operation: string, publicMessage: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => toOperationFailure(cause, { subsystem: 'git', operation, publicMessage }),
  });
}
