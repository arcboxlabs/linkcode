import { Data } from 'effect';

export type RequestErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | 'unsupported'
  | 'limit_exceeded'
  | 'cancelled';

export class RequestError extends Data.TaggedError('RequestError')<{
  readonly code: RequestErrorCode;
  readonly message: string;
}> {}

export type OperationSubsystem =
  | 'agent'
  | 'asset'
  | 'filesystem'
  | 'git'
  | 'pty'
  | 'runtime-probe'
  | 'store'
  | 'translator'
  | 'transport';

export class OperationError extends Data.TaggedError('OperationError')<{
  readonly subsystem: OperationSubsystem;
  readonly operation: string;
  readonly publicMessage: string;
  readonly cause: unknown;
}> {}

export class OperationTimeout extends Data.TaggedError('OperationTimeout')<{
  readonly operation: string;
  /** Timeout duration in milliseconds. */
  readonly duration: number;
  readonly publicMessage: string;
}> {}

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
}

export function toRequestFailure(error: unknown): RequestFailure {
  if (error instanceof RequestError) return { code: error.code, message: error.message };
  if (error instanceof OperationError) {
    return { code: 'operation_failed', message: error.publicMessage };
  }
  if (error instanceof OperationTimeout) {
    return { code: 'timeout', message: error.publicMessage };
  }
  return { code: 'internal_error', message: 'Internal engine error' };
}
