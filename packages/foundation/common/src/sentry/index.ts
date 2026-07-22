interface TransactionSpan {
  data?: unknown;
  description?: unknown;
  op?: unknown;
  trace_id?: unknown;
  span_id?: unknown;
  parent_span_id?: unknown;
  start_timestamp?: unknown;
  timestamp?: unknown;
  status?: unknown;
  exclusive_time?: unknown;
  measurements?: unknown;
}

export interface SentryTransactionEvent {
  event_id?: unknown;
  timestamp?: unknown;
  start_timestamp?: unknown;
  type?: unknown;
  transaction?: string;
  transaction_info?: unknown;
  contexts?: Record<string, unknown>;
  spans?: TransactionSpan[];
  measurements?: unknown;
}

export interface SentryTransactionPrivacyOptions {
  fallbackTransactionName: string;
  safeTransactionNames?: readonly string[];
  safeSpanNames?: readonly string[];
  safeMeasurementNames?: readonly string[];
}

const RE_EVENT_ID = /^[\da-f]{32}$/;
const RE_TRACE_ID = /^[\da-f]{32}$/;
const RE_SPAN_ID = /^[\da-f]{16}$/;
const SAFE_OPS = new Set([
  'app.start',
  'app.start.cold',
  'app.start.warm',
  'browser',
  'browser.long-animation-frame',
  'browser.long-task',
  'ipc.renderer',
  'navigation',
  'pageload',
  'ui.action.click',
  'ui.load',
  'ui.load.full_display',
  'ui.load.initial_display',
  'ui.react.mount',
  'ui.react.render',
  'ui.react.update',
]);
const SAFE_STATUSES = new Set([
  'ok',
  'cancelled',
  'unknown_error',
  'invalid_argument',
  'deadline_exceeded',
  'not_found',
  'already_exists',
  'permission_denied',
  'resource_exhausted',
  'failed_precondition',
  'aborted',
  'out_of_range',
  'unimplemented',
  'internal_error',
  'unavailable',
  'data_loss',
  'unauthenticated',
]);
const SAFE_MEASUREMENT_UNITS = new Set([
  'none',
  'nanosecond',
  'microsecond',
  'millisecond',
  'second',
  'byte',
  'kilobyte',
  'megabyte',
  'gigabyte',
  'ratio',
  'percent',
]);

/**
 * Reconstructs a transaction from validated timing and trace primitives. Automatic browser/mobile
 * tracing can otherwise attach URLs, route params, request data, and arbitrary span attributes.
 */
export function sanitizeSentryTransaction<T extends SentryTransactionEvent>(
  event: T,
  options: SentryTransactionPrivacyOptions,
): T {
  const transaction =
    event.transaction && options.safeTransactionNames?.includes(event.transaction)
      ? event.transaction
      : options.fallbackTransactionName;
  const trace = isRecord(event.contexts?.trace)
    ? sanitizeTraceContext(event.contexts.trace)
    : undefined;
  const spans: TransactionSpan[] = [];
  for (const span of event.spans ?? []) {
    const sanitizedSpan = sanitizeSpan(span, options);
    if (sanitizedSpan) spans.push(sanitizedSpan);
  }
  const sanitized: SentryTransactionEvent = {
    event_id: validId(event.event_id, RE_EVENT_ID),
    timestamp: finiteNumber(event.timestamp),
    start_timestamp: finiteNumber(event.start_timestamp),
    type: 'transaction',
    transaction,
    transaction_info: { source: 'custom' },
    contexts: trace ? { trace } : undefined,
    spans: event.spans ? spans : undefined,
    measurements: sanitizeMeasurements(event.measurements, options.safeMeasurementNames),
  };

  for (const key of Object.keys(event)) Reflect.deleteProperty(event, key);
  Object.assign(event, sanitized);
  return event;
}

function sanitizeSpan(
  span: TransactionSpan,
  options: SentryTransactionPrivacyOptions,
): TransactionSpan | null {
  const traceId = validId(span.trace_id, RE_TRACE_ID);
  const spanId = validId(span.span_id, RE_SPAN_ID);
  const startTimestamp = finiteNumber(span.start_timestamp);
  if (!traceId || !spanId || startTimestamp === undefined) return null;

  const description =
    typeof span.description === 'string' && options.safeSpanNames?.includes(span.description)
      ? span.description
      : undefined;
  return {
    trace_id: traceId,
    span_id: spanId,
    parent_span_id: validId(span.parent_span_id, RE_SPAN_ID),
    start_timestamp: startTimestamp,
    timestamp: finiteNumber(span.timestamp),
    status: safeString(span.status, SAFE_STATUSES),
    op: safeString(span.op, SAFE_OPS),
    exclusive_time: finiteNumber(span.exclusive_time),
    data: {},
    description,
    measurements: sanitizeMeasurements(span.measurements, options.safeMeasurementNames),
  };
}

function sanitizeTraceContext(trace: Record<string, unknown>): Record<string, unknown> | undefined {
  const traceId = validId(trace.trace_id, RE_TRACE_ID);
  const spanId = validId(trace.span_id, RE_SPAN_ID);
  if (!traceId || !spanId) return undefined;
  return {
    trace_id: traceId,
    span_id: spanId,
    parent_span_id: validId(trace.parent_span_id, RE_SPAN_ID),
    op: safeString(trace.op, SAFE_OPS),
    status: safeString(trace.status, SAFE_STATUSES),
  };
}

function sanitizeMeasurements(
  measurements: unknown,
  safeNames: readonly string[] | undefined,
): Record<string, { value: number; unit?: string }> | undefined {
  if (!isRecord(measurements) || !safeNames?.length) return undefined;
  const sanitized: Record<string, { value: number; unit?: string }> = {};
  let hasMeasurement = false;
  for (const name of safeNames) {
    const measurement = measurements[name];
    if (!isRecord(measurement)) continue;
    const value = finiteNumber(measurement.value);
    if (value === undefined) continue;
    const unit = safeString(measurement.unit, SAFE_MEASUREMENT_UNITS);
    sanitized[name] = unit ? { value, unit } : { value };
    hasMeasurement = true;
  }
  return hasMeasurement ? sanitized : undefined;
}

function validId(value: unknown, pattern: RegExp): string | undefined {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function safeString(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  return typeof value === 'string' && allowed.has(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
