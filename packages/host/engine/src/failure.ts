import { Data } from 'effect';

interface FailureReporting {
  /** True only when an emitted conversation event already owns presentation of this failure. */
  readonly reportedInConversation?: true;
}

export type RequestErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  /** The request was understood and refused — the user withheld consent, not a broken call. */
  | 'forbidden'
  | 'unsupported'
  | 'worktree_missing'
  | 'limit_exceeded'
  | 'cancelled';

export class RequestError extends Data.TaggedError('RequestError')<
  FailureReporting & {
    readonly code: RequestErrorCode;
    readonly message: string;
  }
> {}

export type OperationSubsystem =
  | 'agent'
  | 'asset'
  | 'filesystem'
  | 'git'
  | 'preview'
  | 'pty'
  | 'runtime-probe'
  | 'script'
  | 'simulator'
  | 'store'
  | 'translator'
  | 'transport';

export class OperationError extends Data.TaggedError('OperationError')<
  FailureReporting & {
    readonly subsystem: OperationSubsystem;
    readonly operation: string;
    readonly publicMessage: string;
    readonly cause: unknown;
  }
> {}

export class OperationTimeout extends Data.TaggedError('OperationTimeout')<
  FailureReporting & {
    readonly operation: string;
    /** Timeout duration in milliseconds. */
    readonly duration: number;
    readonly publicMessage: string;
  }
> {}

export type EngineFailure = RequestError | OperationError | OperationTimeout;

export function toOperationFailure(
  cause: unknown,
  context: {
    readonly subsystem: OperationSubsystem;
    readonly operation: string;
    readonly publicMessage: string;
  },
): EngineFailure {
  if (
    cause instanceof RequestError ||
    cause instanceof OperationError ||
    cause instanceof OperationTimeout
  ) {
    return cause;
  }
  return new OperationError({ ...context, cause });
}

export type RequestFailureCode =
  | RequestErrorCode
  | 'operation_failed'
  | 'timeout'
  | 'internal_error';

export interface RequestFailure {
  readonly code: RequestFailureCode;
  readonly message: string;
  readonly reportedInConversation?: true;
}

export function toRequestFailure(error: unknown): RequestFailure {
  if (error instanceof RequestError) {
    return withFailureReporting(error, { code: error.code, message: error.message });
  }
  if (error instanceof OperationError) {
    return withFailureReporting(error, {
      code: 'operation_failed',
      message: error.publicMessage,
    });
  }
  if (error instanceof OperationTimeout) {
    return withFailureReporting(error, { code: 'timeout', message: error.publicMessage });
  }
  return { code: 'internal_error', message: 'Internal engine error' };
}

function withFailureReporting(error: FailureReporting, failure: RequestFailure): RequestFailure {
  return error.reportedInConversation === true
    ? { ...failure, reportedInConversation: true }
    : failure;
}
