import { Data } from 'effect';
import { OperationError } from '../failure';

interface DiagnosticFailure {
  readonly cause?: unknown;
}

export class AutomationTimeout extends Data.TaggedError('AutomationTimeout')<
  DiagnosticFailure & { readonly durationMs: number }
> {}

export class AutomationBusy extends Data.TaggedError('AutomationBusy')<DiagnosticFailure> {}

export class AutomationUnattended extends Data.TaggedError('AutomationUnattended')<
  DiagnosticFailure & { readonly request: 'permission' | 'input' }
> {}

export class AutomationTargetGone extends Data.TaggedError(
  'AutomationTargetGone',
)<DiagnosticFailure> {}

export class AutomationDispatchFailure extends Data.TaggedError(
  'AutomationDispatchFailure',
)<DiagnosticFailure> {}

export class AutomationMalformedResponse extends Data.TaggedError('AutomationMalformedResponse')<{
  readonly attempts: number;
}> {}

export type AutomationFailure =
  | AutomationTimeout
  | AutomationBusy
  | AutomationUnattended
  | AutomationTargetGone
  | AutomationDispatchFailure
  | AutomationMalformedResponse;

export function automationFailureMessage(error: AutomationFailure | OperationError): string {
  if (error instanceof OperationError) return error.publicMessage;
  switch (error._tag) {
    case 'AutomationTimeout':
      return 'automation turn timed out';
    case 'AutomationBusy':
      return 'automation target is busy';
    case 'AutomationUnattended':
      return error.request === 'permission'
        ? 'automation requires unattended permission'
        : 'automation requires user input';
    case 'AutomationTargetGone':
      return 'automation target no longer exists';
    case 'AutomationDispatchFailure':
      return 'automation provider failed';
    case 'AutomationMalformedResponse':
      return 'automation returned a malformed structured response';
    default:
      return 'automation failed';
  }
}
