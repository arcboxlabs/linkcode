import { Cause, Logger as EffectLogger } from 'effect';
import { castArray } from 'foxts/cast-array';
import type { ErrorLikeObject } from 'foxts/extract-error-message';
import { isErrorLikeObject } from 'foxts/extract-error-message';
import type { DestinationStream, Logger as PinoLogger } from 'pino';
import createPino from 'pino';
import { sanitizeDiagnostic } from './diagnostic-sanitizer';

const REDACTED = '[Redacted]';

const REDACT_PATHS = [
  'apiKey',
  'authToken',
  'token',
  'attachmentSecret',
  'credential.key',
  'credential.token',
  'headers.authorization',
  '*.apiKey',
  '*.authToken',
  '*.token',
  '*.attachmentSecret',
  '*.credential.key',
  '*.credential.token',
  '*.headers.authorization',
  'providers.*.apiKey',
  'accounts.*.credential.key',
] as const;

const EFFECT_BINDING_KEYS = [
  'sessionId',
  'terminalId',
  'scheduleId',
  'runId',
  'loopId',
  'iteration',
  'agentKind',
  'subsystem',
  'operation',
  'pid',
  'listenerType',
  'url',
] as const;

function defaultDestination(): DestinationStream {
  return createPino.destination({ dest: 1, sync: true });
}

export function createDaemonLogger(
  destination: DestinationStream = defaultDestination(),
): PinoLogger {
  return createPino(
    {
      name: 'linkcode-daemon',
      hooks: {
        logMethod(args, method) {
          for (let index = 0; index < args.length; index += 1) {
            args[index] = sanitizeDiagnostic(args[index]);
          }
          method.apply(this, args);
        },
      },
      redact: {
        paths: [...REDACT_PATHS],
        censor: REDACTED,
      },
      serializers: {
        err: sanitizeDiagnostic,
      },
    },
    destination,
  );
}

export const logger = createDaemonLogger();

function effectBindings(messages: readonly unknown[]): Record<string, string | number> {
  const bindings: Record<string, string | number> = { source: 'effect' };
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue;
    for (const key of EFFECT_BINDING_KEYS) {
      const value = Reflect.get(message, key);
      if (typeof value === 'string' || typeof value === 'number') bindings[key] = value;
    }
  }
  return bindings;
}

function effectError(
  messages: readonly unknown[],
  cause: Cause.Cause<unknown>,
): ErrorLikeObject | undefined {
  const error = messages.find(isErrorLikeObject);
  if (isErrorLikeObject(error)) return error;
  if (cause.reasons.length === 0) return;
  const squashed = Cause.squash(cause);
  return isErrorLikeObject(squashed) ? squashed : new Error(String(squashed));
}

export function createEffectLogger(target: PinoLogger): EffectLogger.Logger<unknown, void> {
  return EffectLogger.make(({ cause, logLevel, message }) => {
    if (logLevel === 'None') return;
    const messages = castArray(message);
    const text = messages.find((entry) => typeof entry === 'string') ?? 'Effect log';
    const bindings: Record<string, unknown> = effectBindings(messages);
    const error = effectError(messages, cause);
    if (error) bindings.err = error;

    switch (logLevel) {
      case 'Fatal':
        target.fatal(bindings, text);
        break;
      case 'Error':
        target.error(bindings, text);
        break;
      case 'Warn':
        target.warn(bindings, text);
        break;
      case 'Info':
        target.info(bindings, text);
        break;
      case 'Debug':
        target.debug(bindings, text);
        break;
      default:
        target.trace(bindings, text);
        break;
    }
  });
}

export const DaemonLoggerLive = EffectLogger.layer([createEffectLogger(logger)]);
